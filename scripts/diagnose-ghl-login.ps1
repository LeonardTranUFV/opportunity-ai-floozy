<#
.SYNOPSIS
    Diagnoses (and optionally fixes) ERR_CONNECTION_RESET on the GHL white-label
    login domain, typically seen on UAE networks (Etisalat / du).

.DESCRIPTION
    login.floozy.ca is a CNAME to GoHighLevel's white-label front
    (whitelabel.ludicrous.cloud), which sits behind Cloudflare. An
    ERR_CONNECTION_RESET with no certificate warning means the TCP connection
    opened and was then killed during the TLS handshake -- a middlebox injecting
    a RST, not a server fault.

    This script walks the connection path one layer at a time and prints a
    verdict naming the layer that breaks:

      DNS -> TCP:443 -> TLS(real SNI) -> TLS(control SNI) -> HTTP:80 -> controls

    A key discriminator: .NET's TLS stack does NOT implement Encrypted
    ClientHello. If the handshake succeeds here but Chrome still resets, the
    culprit is Chrome's ECH, which -Fix turns off.

.PARAMETER TargetHost
    Hostname to test. Defaults to login.floozy.ca.

.PARAMETER Fix
    Applies the Chrome/Edge policy fix (disable ECH + secure DNS). Needs admin.

.PARAMETER Revert
    Removes the policy values written by -Fix. Needs admin.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\diagnose-ghl-login.ps1

.EXAMPLE
    # from an elevated prompt, after the diagnosis points at ECH
    powershell -ExecutionPolicy Bypass -File .\diagnose-ghl-login.ps1 -Fix
#>
[CmdletBinding()]
param(
    [string]$TargetHost = "login.floozy.ca",
    [switch]$Fix,
    [switch]$Revert
)

$ErrorActionPreference = "Continue"

# Hostnames used to tell "this domain is filtered" apart from "the whole path
# to GoHighLevel / Cloudflare is down".
$ControlHosts = @(
    "app.gohighlevel.com",
    "services.leadconnectorhq.com",
    "www.cloudflare.com"
)

# SNI sent to the target's own IPs to prove whether the block keys on the name.
$ControlSni = "www.cloudflare.com"

$PolicyKeys = @(
    "HKLM:\SOFTWARE\Policies\Google\Chrome",
    "HKLM:\SOFTWARE\Policies\Microsoft\Edge"
)

function Write-Section {
    param([string]$Title)
    Write-Host ""
    Write-Host ("=" * 72) -ForegroundColor DarkGray
    Write-Host "  $Title" -ForegroundColor Cyan
    Write-Host ("=" * 72) -ForegroundColor DarkGray
}

function Write-Pass { param([string]$Message) Write-Host "  [ OK ]   $Message" -ForegroundColor Green }
function Write-Fail { param([string]$Message) Write-Host "  [FAIL]   $Message" -ForegroundColor Red }
function Write-Info { param([string]$Message) Write-Host "  [ .. ]   $Message" -ForegroundColor Gray }
function Write-Warn { param([string]$Message) Write-Host "  [WARN]   $Message" -ForegroundColor Yellow }

function Test-IsAdmin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-SslProtocols {
    # Tls13 only exists on .NET Framework 4.8+; fall back cleanly on older boxes.
    $protocols = [System.Security.Authentication.SslProtocols]::Tls12
    try {
        $protocols = $protocols -bor [System.Security.Authentication.SslProtocols]::Tls13
    } catch {
        Write-Verbose "TLS 1.3 unavailable on this runtime; testing TLS 1.2 only."
    }
    $protocols
}

function Test-TlsHandshake {
    <#
        Opens TCP, then drives a TLS handshake with an explicit SNI value.
        Returns which layer succeeded and, on failure, the raw socket error --
        "forcibly closed" / "connection was reset" is the RST signature.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$IpAddress,
        [Parameter(Mandatory = $true)][string]$Sni,
        [int]$Port = 443,
        [int]$TimeoutMs = 8000
    )

    $outcome = [ordered]@{
        Ip       = $IpAddress
        Sni      = $Sni
        Tcp      = $false
        Tls      = $false
        Protocol = $null
        Issuer   = $null
        Error    = $null
    }

    $client = New-Object System.Net.Sockets.TcpClient
    $ssl = $null
    try {
        $async = $client.BeginConnect($IpAddress, $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne($TimeoutMs)) {
            $outcome.Error = "TCP connect timed out after ${TimeoutMs}ms"
            return [pscustomobject]$outcome
        }
        $client.EndConnect($async)
        $outcome.Tcp = $true

        # Certificate validation is deliberately bypassed: we are measuring
        # whether the handshake completes at all, not trusting the endpoint.
        $acceptAll = [System.Net.Security.RemoteCertificateValidationCallback] { param($s, $c, $ch, $e) $true }
        $ssl = New-Object System.Net.Security.SslStream($client.GetStream(), $false, $acceptAll)
        $ssl.ReadTimeout = $TimeoutMs
        $ssl.WriteTimeout = $TimeoutMs
        $ssl.AuthenticateAsClient($Sni, $null, (Get-SslProtocols), $false)

        $outcome.Tls = $true
        $outcome.Protocol = $ssl.SslProtocol.ToString()
        if ($ssl.RemoteCertificate) {
            $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($ssl.RemoteCertificate)
            $outcome.Issuer = $cert.Issuer
        }
    } catch {
        $outcome.Error = $_.Exception.GetBaseException().Message
    } finally {
        if ($ssl) { $ssl.Dispose() }
        $client.Close()
    }

    [pscustomobject]$outcome
}

function Test-PlainHttp {
    # Port 80 is unencrypted, so a name-based filter that only inspects TLS
    # SNI will let it through. 80 up + 443 reset is the filter's fingerprint.
    param([string]$Name, [int]$TimeoutMs = 8000)

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect($Name, 80, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne($TimeoutMs)) { return "timeout" }
        $client.EndConnect($async)

        $stream = $client.GetStream()
        $stream.ReadTimeout = $TimeoutMs
        $request = "HEAD / HTTP/1.1`r`nHost: $Name`r`nConnection: close`r`n`r`n"
        $bytes = [System.Text.Encoding]::ASCII.GetBytes($request)
        $stream.Write($bytes, 0, $bytes.Length)

        $reader = New-Object System.IO.StreamReader($stream)
        $statusLine = $reader.ReadLine()
        if ($statusLine) { return $statusLine.Trim() }
        return "no response"
    } catch {
        return "error: " + $_.Exception.GetBaseException().Message
    } finally {
        $client.Close()
    }
}

function Invoke-PolicyFix {
    param([switch]$Undo)

    if (-not (Test-IsAdmin)) {
        Write-Fail "Administrator rights required. Re-run this script from an elevated PowerShell."
        return
    }

    foreach ($key in $PolicyKeys) {
        $browser = if ($key -match "Chrome") { "Chrome" } else { "Edge" }

        if ($Undo) {
            if (Test-Path $key) {
                Remove-ItemProperty -Path $key -Name "EncryptedClientHelloEnabled" -ErrorAction SilentlyContinue
                Remove-ItemProperty -Path $key -Name "DnsOverHttpsMode" -ErrorAction SilentlyContinue
                Write-Pass "$browser policy values removed."
            } else {
                Write-Info "$browser policy key absent; nothing to revert."
            }
            continue
        }

        if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
        Set-ItemProperty -Path $key -Name "EncryptedClientHelloEnabled" -Value 0 -Type DWord
        Set-ItemProperty -Path $key -Name "DnsOverHttpsMode" -Value "off" -Type String
        Write-Pass "$browser: Encrypted ClientHello disabled, secure DNS off."
    }

    Write-Host ""
    Write-Warn "Fully quit the browser (check Task Manager for stray processes) and reopen it."
    Write-Warn "These are machine-wide policies, so the browser will show 'Managed by your organization'."
    if (-not $Undo) { Write-Info "Undo at any time with:  .\diagnose-ghl-login.ps1 -Revert" }
}

# --------------------------------------------------------------------------
# Fix / revert modes short-circuit the diagnosis.
# --------------------------------------------------------------------------

if ($Fix -and $Revert) {
    Write-Fail "Pass either -Fix or -Revert, not both."
    exit 1
}

if ($Fix -or $Revert) {
    Write-Section $(if ($Revert) { "Reverting browser policy" } else { "Applying browser policy fix" })
    Invoke-PolicyFix -Undo:$Revert
    exit 0
}

# --------------------------------------------------------------------------
# Diagnosis
# --------------------------------------------------------------------------

Write-Section "GHL login connectivity check -- $TargetHost"
Write-Info ("Machine: {0}   User: {1}" -f $env:COMPUTERNAME, $env:USERNAME)
Write-Info ("Time:    {0}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz"))

# --- Layer 1: DNS ---------------------------------------------------------

Write-Section "1. DNS resolution"

$addresses = @()
$dnsRecords = Resolve-DnsName -Name $TargetHost -Type A -ErrorAction SilentlyContinue
if (-not $dnsRecords) {
    Write-Fail "$TargetHost does not resolve on the local resolver."
} else {
    foreach ($record in $dnsRecords) {
        if ($record.Type -eq "CNAME") { Write-Info ("CNAME  {0} -> {1}" -f $record.Name, $record.NameHost) }
        if ($record.IPAddress) {
            $addresses += $record.IPAddress
            Write-Pass ("A      {0} -> {1}" -f $record.Name, $record.IPAddress)
        }
    }
}

# A local answer that differs from a public resolver means the network is
# rewriting DNS rather than filtering TLS.
$publicRecords = Resolve-DnsName -Name $TargetHost -Type A -Server "1.1.1.1" -ErrorAction SilentlyContinue
if ($publicRecords) {
    $publicAddresses = @($publicRecords | Where-Object { $_.IPAddress } | ForEach-Object { $_.IPAddress })
    if ($publicAddresses.Count -gt 0) {
        Write-Info ("Cloudflare 1.1.1.1 answers: {0}" -f ($publicAddresses -join ", "))
        $divergent = @($publicAddresses | Where-Object { $addresses -notcontains $_ })
        if ($addresses.Count -gt 0 -and $divergent.Count -eq $publicAddresses.Count) {
            Write-Warn "Local resolver disagrees with 1.1.1.1 -- possible DNS interception."
        }
    }
} else {
    Write-Warn "Could not reach 1.1.1.1 for a second opinion (UDP/53 may be blocked)."
}

# --- Layer 2: ECH advertisement ------------------------------------------

Write-Section "2. Encrypted ClientHello advertisement (HTTPS/SVCB record)"

$echAdvertised = $false
$httpsRecords = $null
try {
    $httpsRecords = Resolve-DnsName -Name $TargetHost -Type 65 -ErrorAction SilentlyContinue
} catch {
    Write-Info "This Windows build's Resolve-DnsName cannot query type 65; skipping."
}
if ($httpsRecords) {
    foreach ($record in $httpsRecords) {
        $blob = ($record | Out-String)
        if ($blob -match "ech") { $echAdvertised = $true }
    }
    if ($echAdvertised) {
        Write-Warn "An HTTPS record advertising ECH is published for this host."
        Write-Info "Chrome will attempt Encrypted ClientHello, which UAE DPI commonly resets."
    } else {
        Write-Info "HTTPS record present, no ECH parameter detected."
    }
} else {
    Write-Info "No HTTPS/SVCB record returned (this resolver may not forward type 65)."
}

# --- Layer 3+4: TCP and TLS to each edge IP -------------------------------

Write-Section "3. TCP + TLS handshake to each edge IP"

$targetResults = @()
foreach ($address in $addresses) {
    $real = Test-TlsHandshake -IpAddress $address -Sni $TargetHost
    $targetResults += $real

    if (-not $real.Tcp) {
        Write-Fail ("{0}  TCP:443 failed -- {1}" -f $address, $real.Error)
    } elseif ($real.Tls) {
        Write-Pass ("{0}  TLS OK via SNI {1} ({2})" -f $address, $TargetHost, $real.Protocol)
        if ($real.Issuer) {
            Write-Info ("         certificate issuer: {0}" -f $real.Issuer)
            if ($real.Issuer -notmatch "Google Trust|Let's Encrypt|DigiCert|Cloudflare|Sectigo|Baltimore") {
                Write-Warn "         unexpected issuer -- something is intercepting TLS (AV or corporate proxy)."
            }
        }
    } else {
        Write-Fail ("{0}  TCP open but TLS failed -- {1}" -f $address, $real.Error)

        # Same IP, innocuous SNI. Success here isolates the block to the name.
        $control = Test-TlsHandshake -IpAddress $address -Sni $ControlSni
        if ($control.Tls) {
            Write-Warn ("{0}  ...but TLS to the SAME IP succeeds with SNI {1}" -f $address, $ControlSni)
            Write-Warn "         => the block keys on the hostname, not the IP."
        } else {
            Write-Info ("{0}  control SNI also fails -- {1}" -f $address, $control.Error)
        }
    }
}

if ($addresses.Count -eq 0) { Write-Info "Skipped: no addresses to test." }

# --- Layer 5: plaintext HTTP ---------------------------------------------

Write-Section "4. Plaintext HTTP on port 80"

$httpStatus = Test-PlainHttp -Name $TargetHost
Write-Info ("HTTP/80 response: {0}" -f $httpStatus)

# --- Layer 6: control hosts ----------------------------------------------

Write-Section "5. Control hosts"

$controlOk = 0
foreach ($name in $ControlHosts) {
    $record = Resolve-DnsName -Name $name -Type A -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress } | Select-Object -First 1
    if (-not $record) {
        Write-Fail ("{0}  did not resolve" -f $name)
        continue
    }
    $result = Test-TlsHandshake -IpAddress $record.IPAddress -Sni $name
    if ($result.Tls) {
        Write-Pass ("{0}  reachable ({1})" -f $name, $result.Protocol)
        $controlOk++
    } else {
        Write-Fail ("{0}  unreachable -- {1}" -f $name, $result.Error)
    }
}

# --- Verdict --------------------------------------------------------------

Write-Section "Verdict"

$tcpOk = @($targetResults | Where-Object { $_.Tcp }).Count
$tlsOk = @($targetResults | Where-Object { $_.Tls }).Count
$httpOk = ($httpStatus -match "^HTTP/")

if ($addresses.Count -eq 0) {
    Write-Fail "DNS is the failure point -- the hostname does not resolve here."
    Write-Info "Set the adapter's DNS to 1.1.1.1 / 8.8.8.8 and retry."
} elseif ($tcpOk -eq 0) {
    Write-Fail "Blocked at the IP layer -- TCP:443 never opens to any Cloudflare edge IP."
    Write-Info "A hostname change will NOT help. Use a VPN, or ask GHL to move the domain to a different edge."
} elseif ($tlsOk -eq 0) {
    Write-Fail "Blocked at the TLS layer -- TCP opens, the handshake is reset."
    if ($httpOk) { Write-Info "Port 80 answers while 443 is reset: SNI-based filtering, confirmed." }
    if ($controlOk -gt 0) { Write-Info "Other Cloudflare/GHL hosts work, so this is specific to $TargetHost." }
    Write-Info "Fix: use a VPN, or rename the white-label host in GHL (Settings > Company > Domains)."
} elseif ($tlsOk -gt 0) {
    Write-Pass "The network path is clean -- TLS completes from PowerShell."
    Write-Host ""
    Write-Warn "If Chrome still shows ERR_CONNECTION_RESET, the cause is browser-side."
    Write-Info "PowerShell's TLS stack does not use Encrypted ClientHello; Chrome does."
    if ($echAdvertised) { Write-Info "This host advertises ECH, which makes that the likely culprit." }
    Write-Info "Apply the fix from an elevated prompt:  .\diagnose-ghl-login.ps1 -Fix"
    Write-Info "If that does not clear it, suspect antivirus HTTPS scanning or a browser extension."
}

Write-Host ""
