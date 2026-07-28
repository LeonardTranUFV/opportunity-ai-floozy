"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { X } from "lucide-react"
import { CITY_CLUSTERS, clusterFor } from "@/lib/nearby-cities"
import { cn } from "@/lib/utils"

export function LocationPicker({ value, onChange }: { value: string[]; onChange: (cities: string[]) => void }) {
  const [search, setSearch] = useState("")
  const [customCity, setCustomCity] = useState("")

  const toggleCity = (city: string) => {
    if (value.includes(city)) {
      onChange(value.filter((c) => c !== city))
      return
    }
    // Picking a city suggests its whole metro cluster at once, rather than
    // making someone type out every neighboring city by hand — they can
    // still uncheck any they don't want.
    const cluster = clusterFor(city)
    const additions = cluster.length > 0 ? cluster.filter((c) => !value.includes(c)) : [city]
    onChange([...value, ...additions])
  }

  const addCustomCity = () => {
    const trimmed = customCity.trim()
    if (!trimmed || value.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      setCustomCity("")
      return
    }
    onChange([...value, trimmed])
    setCustomCity("")
  }

  const filteredClusters = CITY_CLUSTERS.map((cluster) => ({
    ...cluster,
    cities: cluster.cities.filter((c) => c.toLowerCase().includes(search.toLowerCase())),
  })).filter((cluster) => cluster.cities.length > 0)

  return (
    <div className="flex flex-col gap-3">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((city) => (
            <Badge key={city} variant="brand" className="gap-1 pr-1">
              {city}
              <button
                type="button"
                onClick={() => onChange(value.filter((c) => c !== city))}
                className="rounded-full p-0.5 hover:bg-brand/20"
                aria-label={`Remove ${city}`}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search cities…"
      />

      <div className="flex max-h-48 flex-col gap-3 overflow-y-auto rounded-md border border-border p-2.5">
        {filteredClusters.length === 0 ? (
          <p className="text-xs text-muted-foreground">No matching cities — add it below instead.</p>
        ) : (
          filteredClusters.map((cluster) => (
            <div key={cluster.region} className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">{cluster.region}</span>
              <div className="flex flex-wrap gap-1.5">
                {cluster.cities.map((city) => (
                  <button
                    key={city}
                    type="button"
                    onClick={() => toggleCity(city)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs transition-colors",
                      value.includes(city)
                        ? "border-brand/40 bg-brand/10 text-brand"
                        : "border-border hover:border-brand/30 hover:bg-brand/5"
                    )}
                  >
                    {city}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Input
            value={customCity}
            onChange={(e) => setCustomCity(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                addCustomCity()
              }
            }}
            placeholder="Not listed? Type a city and press Enter"
          />
        </div>
      </div>
    </div>
  )
}
