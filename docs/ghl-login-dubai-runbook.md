# GHL login fails in the UAE — `ERR_CONNECTION_RESET`

Chrome shows **This site can't be reached / The connection was reset** on
`https://login.floozy.ca`, with no certificate warning. Reported from Dubai.

## What the error actually means

DNS resolved, TCP connected, and then the connection was killed mid-TLS-handshake.
That rules out the usual suspects up front:

| Symptom you'd see | Cause | Ruled out? |
|---|---|---|
| `ERR_NAME_NOT_RESOLVED` | DNS | yes — the name resolves |
| `ERR_CERT_*` / interstitial | expired or missing SSL | yes — no cert warning |
| `ERR_CONNECTION_TIMED_OUT` | host down, packets dropped | yes — reset is not a timeout |
| **`ERR_CONNECTION_RESET`** | **a middlebox injected a TCP RST** | **this is us** |

## The domain

```
login.floozy.ca  →  CNAME whitelabel.ludicrous.cloud  →  104.18.37.19, 172.64.150.237
```

`ludicrous.cloud` is GoHighLevel's white-label front, sitting behind Cloudflare.
So the TLS endpoint is a Cloudflare edge — we do not control its TLS settings,
only the DNS record that points at it.

Two things follow: a Cloudflare-fronted hostname is exactly what UAE DPI
inspects, and any fix at the edge has to come from GHL, not from us.

## Rank-ordered causes on a UAE network

1. **ISP deep-packet inspection (Etisalat / du).** The middlebox reads the TLS
   ClientHello and resets. It trips either on the cleartext SNI hostname, or —
   more often lately — on Chrome's **Encrypted ClientHello**, which it cannot
   parse. Cloudflare-hosted zones get hit by this routinely.
2. **Cloudflare edge routing** to the Dubai PoP, or those specific IPs filtered.
3. **Local**: corporate/hotel firewall, a half-connected VPN, or antivirus HTTPS
   scanning (Kaspersky, Bitdefender, ESET web shields reset handshakes they
   cannot intercept).

## Run the diagnosis

On the affected Windows machine, from the repo root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\diagnose-ghl-login.ps1
```

It walks the path one layer at a time — DNS, TCP:443, TLS with the real SNI,
TLS to the same IP with an innocuous SNI, plaintext HTTP:80, then control hosts
— and prints a verdict naming the layer that breaks.

The decisive trick: **PowerShell's TLS stack does not implement Encrypted
ClientHello, but Chrome's does.** If the script's handshake succeeds while
Chrome still resets, ECH is the culprit and nothing about the network needs to
change.

### macOS / Linux equivalent

```bash
curl -v https://login.floozy.ca 2>&1 | head -30                  # does TLS complete?
curl -v http://login.floozy.ca  2>&1 | head -20                  # port 80 — filter check
curl -v --resolve login.floozy.ca:443:172.64.150.237 \
     https://login.floozy.ca   2>&1 | head -20                   # the other edge IP
```

Port 80 answering while 443 resets is the SNI-filter fingerprint.

## Fixes, by verdict

| Verdict | Fix |
|---|---|
| TLS completes in the script, Chrome still resets | Run `.\scripts\diagnose-ghl-login.ps1 -Fix` from an **elevated** prompt. Disables ECH and secure DNS for Chrome and Edge, then fully restart the browser. |
| TLS reset with the real SNI, OK with the control SNI | Hostname-keyed filtering. Rename the white-label host (`app.floozy.ca` instead of `login.floozy.ca`) in GHL → Settings → Company → Domains. A fresh SNI string often is not on the filter list. |
| TCP:443 never opens | IP-level block. A rename will not help — use a VPN, and ask GHL to move the domain to a different edge. |
| Everything passes | Local. Test in incognito with extensions off, then pause antivirus HTTPS/web scanning. |

The `-Fix` switch writes two documented enterprise policies to
`HKLM\SOFTWARE\Policies\{Google\Chrome,Microsoft\Edge}`:

- `EncryptedClientHelloEnabled` = `0` (DWORD)
- `DnsOverHttpsMode` = `"off"` (String)

Both are machine-wide, so the browser will start showing *"Managed by your
organization"*. Undo with `-Revert`.

## Workarounds while the root cause is open

- **Log in at `https://app.gohighlevel.com`** with the same credentials.
  Unbranded, but it bypasses our domain entirely — hand this to anyone in Dubai
  who is blocked right now.
- **Cloudflare WARP (the 1.1.1.1 app) or a corporate VPN.** The UAE permits VPNs
  for legitimate business use but penalises using one to reach blocked content
  or VoIP, so route this through a company VPN rather than a free consumer one.

## Escalation to GHL

If the script points at the edge rather than the browser, open a ticket citing:

- the white-label hostname and its CNAME target (`whitelabel.ludicrous.cloud`),
- the resolved edge IPs and the country the failure is observed from,
- the script's verdict block,
- and a request to confirm whether other UAE clients are reporting resets on
  that white-label front, and whether ECH can be disabled for the zone.

Only GHL can change the Cloudflare zone settings for `ludicrous.cloud`.

## Unrelated, but you will hit it next

GHL's calling and voice features run on Twilio VoIP, which the UAE blocks
outright. That is a separate restriction from this one, it will not be fixed by
anything above, and a VPN is the only way around it.
