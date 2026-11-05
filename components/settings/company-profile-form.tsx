"use client"

import { useMemo, useState, useTransition } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { readApiError } from "@/lib/format-error"
import { cn } from "@/lib/utils"
import { PROFILE_LIMITS, TRADE_OPTIONS, type CompanyProfile } from "@/lib/company-profile"
import type { AreaChoice, ServiceArea } from "@/lib/service-areas"

const chip = (on: boolean) =>
  cn(
    "rounded-full border px-2.5 py-1 text-xs transition-colors",
    on ? "border-brand/40 bg-brand/10 text-brand" : "border-border hover:border-brand/30 hover:bg-brand/5"
  )

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/**
 * Who the client is, what they do, where they work and which jobs they want.
 * Floozy uses the trades and areas to decide which leads to send them; the AI
 * uses the rest to write comments and DMs that sound like them.
 */
export function CompanyProfileForm({
  initial,
  areas,
  migrated,
}: {
  initial: CompanyProfile
  areas: ServiceArea[]
  migrated: boolean
}) {
  const [p, setP] = useState<CompanyProfile>(initial)
  const [areaSearch, setAreaSearch] = useState("")
  const [isPending, startTransition] = useTransition()
  const [status, setStatus] = useState<{ kind: "ok" | "warn" | "error"; text: string } | null>(null)

  const set = <K extends keyof CompanyProfile>(key: K, value: CompanyProfile[K]) =>
    setP((prev) => ({ ...prev, [key]: value }))

  const toggleTrade = (id: string) =>
    set("trades", p.trades.includes(id) ? p.trades.filter((t) => t !== id) : [...p.trades, id])

  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas])

  const matchingAreas = useMemo(() => {
    const q = areaSearch.trim().toLowerCase()
    if (!q) return []
    return areas
      .filter((a) => !p.areas.some((c) => c.areaId === a.id))
      .filter((a) => a.name.toLowerCase().includes(q) || a.cities.some((c) => c.toLowerCase().includes(q)))
      .slice(0, 8)
  }, [areaSearch, areas, p.areas])

  const addArea = (id: string) => {
    if (p.areas.length >= PROFILE_LIMITS.areas) return
    set("areas", [...p.areas, { areaId: id, cities: [] }])
    setAreaSearch("")
  }

  const removeArea = (id: string) => set("areas", p.areas.filter((a) => a.areaId !== id))

  /** Empty cities = the whole area, so the first untick lists every other city. */
  const toggleCity = (choice: AreaChoice, city: string) => {
    const area = areaById.get(choice.areaId)
    if (!area) return
    const current = choice.cities.length === 0 ? area.cities : choice.cities
    let next = current.includes(city) ? current.filter((c) => c !== city) : [...current, city]
    if (next.length === area.cities.length) next = []
    if (next.length === 0 && current.length === 1 && current[0] === city) return // keep at least one city
    set(
      "areas",
      p.areas.map((a) => (a.areaId === choice.areaId ? { ...a, cities: next } : a))
    )
  }

  const handleSave = () => {
    setStatus(null)
    startTransition(async () => {
      const res = await fetch("/api/company-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      })
      if (!res.ok) {
        setStatus({ kind: "error", text: await readApiError(res, "Couldn't save your company profile") })
        return
      }
      const data = (await res.json()) as { migrated: boolean; profile: CompanyProfile }
      setP(data.profile)
      setStatus(
        data.migrated
          ? { kind: "ok", text: "Saved." }
          : {
              kind: "warn",
              text: "Saved your name, business, phone and pitch. Trades, services and areas need a database update first (migration 0021).",
            }
      )
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {!migrated && (
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          Only the basics can be saved until the database is updated (migration 0021).
        </p>
      )}

      <section className="flex flex-col gap-4">
        <h3 className="text-sm font-semibold">About your business</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="cp_owner" label="Your name">
            <Input id="cp_owner" value={p.ownerName} onChange={(e) => set("ownerName", e.target.value)} placeholder="e.g. Leo" />
          </Field>
          <Field id="cp_business" label="Company name">
            <Input
              id="cp_business"
              value={p.businessName}
              onChange={(e) => set("businessName", e.target.value)}
              placeholder="e.g. Leo's Contracting"
            />
          </Field>
          <Field id="cp_phone" label="Best phone number">
            <Input
              id="cp_phone"
              type="tel"
              value={p.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="e.g. (604) 555-0142"
            />
          </Field>
          <Field id="cp_website" label="Website (optional)">
            <Input
              id="cp_website"
              value={p.website}
              onChange={(e) => set("website", e.target.value)}
              placeholder="e.g. leoscontracting.ca"
            />
          </Field>
          <Field id="cp_years" label="Years in the trade">
            <Input
              id="cp_years"
              type="number"
              min={0}
              max={100}
              value={p.yearsExperience ?? ""}
              onChange={(e) => set("yearsExperience", e.target.value === "" ? null : Number(e.target.value))}
              placeholder="e.g. 12"
            />
          </Field>
        </div>
        <Field
          id="cp_about"
          label="What makes you stand out"
          hint="The AI weaves this into the comments and messages it writes for you, so they sound like you and not a template."
        >
          <Textarea
            id="cp_about"
            value={p.about}
            onChange={(e) => set("about", e.target.value)}
            maxLength={PROFILE_LIMITS.longText}
            placeholder="e.g. Free quotes, same-day service, fully insured, 5-star on Google"
          />
        </Field>
      </section>

      <section className="flex flex-col gap-4">
        <h3 className="text-sm font-semibold">What you do</h3>
        <Field id="cp_trades" label={`Your trades (up to ${PROFILE_LIMITS.trades})`} hint="Floozy sends you leads for these trades.">
          <div id="cp_trades" className="flex flex-wrap gap-1.5">
            {TRADE_OPTIONS.map((t) => {
              const on = p.trades.includes(t.id)
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={on}
                  disabled={!on && p.trades.length >= PROFILE_LIMITS.trades}
                  onClick={() => toggleTrade(t.id)}
                  className={cn(chip(on), "disabled:opacity-40")}
                >
                  <span aria-hidden>{t.icon}</span> {t.label}
                </button>
              )
            })}
          </div>
        </Field>
        <Field id="cp_services" label="Services you offer">
          <Textarea
            id="cp_services"
            value={p.services}
            onChange={(e) => set("services", e.target.value)}
            maxLength={PROFILE_LIMITS.longText}
            placeholder="e.g. Roof repairs, full re-roofs, gutters, skylights"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="cp_wanted" label="Jobs you want most">
            <Textarea
              id="cp_wanted"
              value={p.wantedJobs}
              onChange={(e) => set("wantedJobs", e.target.value)}
              maxLength={PROFILE_LIMITS.longText}
              placeholder="e.g. Leaks and storm damage, full replacements"
            />
          </Field>
          <Field id="cp_unwanted" label="Jobs to never send you">
            <Textarea
              id="cp_unwanted"
              value={p.unwantedJobs}
              onChange={(e) => set("unwantedJobs", e.target.value)}
              maxLength={PROFILE_LIMITS.longText}
              placeholder="e.g. Commercial flat roofs, anything under $500"
            />
          </Field>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Where you work</h3>
        <p className="text-xs text-muted-foreground">
          Pick up to {PROFILE_LIMITS.areas} areas. Each starts with every city in it; untick the ones you don&apos;t cover.
        </p>

        {p.areas.length === 0 && <p className="text-sm text-muted-foreground">No service area yet.</p>}

        {p.areas.map((choice) => {
          const area = areaById.get(choice.areaId)
          if (!area) return null
          const whole = choice.cities.length === 0
          return (
            <div key={choice.areaId} className="flex flex-col gap-2 rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">
                  {area.name}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    {whole ? "· whole area" : `· ${choice.cities.length} of ${area.cities.length} cities`}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => removeArea(choice.areaId)}
                  className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={`Remove ${area.name}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {area.cities.map((city) => {
                  const on = whole || choice.cities.includes(city)
                  return (
                    <button key={city} type="button" aria-pressed={on} onClick={() => toggleCity(choice, city)} className={chip(on)}>
                      {city}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}

        {p.areas.length < PROFILE_LIMITS.areas && (
          <div className="flex flex-col gap-2">
            <Input
              value={areaSearch}
              onChange={(e) => setAreaSearch(e.target.value)}
              placeholder="Add an area: type a city, e.g. Burnaby"
              aria-label="Search service areas"
            />
            {areaSearch.trim() && (
              <div className="flex flex-wrap gap-1.5">
                {matchingAreas.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No area has that city yet. Pick the nearest one, or ask Floozy to add yours.
                  </p>
                ) : (
                  matchingAreas.map((a) => (
                    <button key={a.id} type="button" onClick={() => addArea(a.id)} className={chip(false)}>
                      + {a.name}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={handleSave} disabled={isPending}>
          {isPending ? "Saving…" : "Save company profile"}
        </Button>
        {status && (
          <span
            role="status"
            className={cn(
              "text-sm",
              status.kind === "ok" && "text-muted-foreground",
              status.kind === "warn" && "text-amber-700 dark:text-amber-300",
              status.kind === "error" && "text-destructive"
            )}
          >
            {status.text}
          </span>
        )}
      </div>
    </div>
  )
}
