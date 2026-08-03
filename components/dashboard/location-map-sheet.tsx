"use client"

import { useEffect, useRef, useState } from "react"
import "leaflet/dist/leaflet.css"
import { MapPin, ExternalLink, LocateFixed } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet"

interface GeocodeResult {
  lat: number
  lng: number
  exact: boolean
  boundingbox: [number, number, number, number] // south, north, west, east
  label: string
}

// Nominatim (OpenStreetMap's free geocoder) result classes/types that indicate a
// precise, pin-pointable place rather than a whole city/region. Anything else
// gets treated as approximate — we only ever have a free-text place name like
// "Vancouver" or "Surrey, BC" (location_mentioned), never a real street address,
// so most lookups will legitimately land in the approximate bucket.
const EXACT_CLASSES = new Set(["building", "amenity", "shop", "office", "house"])

async function geocode(query: string): Promise<GeocodeResult | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`
  const res = await fetch(url, { headers: { Accept: "application/json" } })
  if (!res.ok) return null
  const results = await res.json()
  const r = results?.[0]
  if (!r) return null

  const exact = EXACT_CLASSES.has(r.class) || Boolean(r.address?.house_number)
  const [south, north, west, east] = (r.boundingbox as string[]).map(Number)

  return {
    lat: Number(r.lat),
    lng: Number(r.lon),
    exact,
    boundingbox: [south, north, west, east],
    label: r.display_name,
  }
}

// Rough meters-per-degree at the result's latitude, used to size the
// "approximate area" circle from Nominatim's bounding box.
function boundingRadiusMeters([south, north, west, east]: [number, number, number, number], lat: number): number {
  const latMeters = (north - south) * 111_320
  const lngMeters = (east - west) * 111_320 * Math.cos((lat * Math.PI) / 180)
  const radius = Math.max(latMeters, lngMeters) / 2
  return Math.min(Math.max(radius, 600), 25_000)
}

function LocationMap({ location }: { location: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<"loading" | "found" | "not-found">("loading")

  useEffect(() => {
    let cancelled = false
    let map: import("leaflet").Map | undefined

    async function run() {
      const L = await import("leaflet")
      const result = await geocode(location)
      if (cancelled || !containerRef.current) return

      if (!result) {
        setStatus("not-found")
        return
      }
      setStatus("found")

      map = L.map(containerRef.current, { scrollWheelZoom: false }).setView([result.lat, result.lng], 12)
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map)

      if (result.exact) {
        map.setView([result.lat, result.lng], 15)
        L.circleMarker([result.lat, result.lng], {
          radius: 9,
          color: "#dc2626",
          fillColor: "#dc2626",
          fillOpacity: 0.9,
          weight: 2,
        }).addTo(map)
      } else {
        const radius = boundingRadiusMeters(result.boundingbox, result.lat)
        const circle = L.circle([result.lat, result.lng], {
          radius,
          color: "#f59e0b",
          fillColor: "#f59e0b",
          fillOpacity: 0.15,
          weight: 1.5,
        }).addTo(map)
        L.circleMarker([result.lat, result.lng], {
          radius: 6,
          color: "#f59e0b",
          fillColor: "#f59e0b",
          fillOpacity: 0.9,
          weight: 2,
        }).addTo(map)
        map.fitBounds(circle.getBounds(), { padding: [24, 24] })
      }
    }

    run()

    return () => {
      cancelled = true
      map?.remove()
    }
  }, [location])

  if (status === "not-found") {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed text-center text-sm text-muted-foreground">
        Couldn&apos;t pin this location on the map — try opening it in Google Maps below.
      </div>
    )
  }

  return (
    <div className="relative h-64 overflow-hidden rounded-lg border">
      {status === "loading" && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-muted/40 text-sm text-muted-foreground">
          Locating {location}…
        </div>
      )}
      <div ref={containerRef} className="h-full w-full" />
    </div>
  )
}

export function LocationMapSheet({ location, count }: { location: string; count: number }) {
  const [open, setOpen] = useState(false)
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <button
            type="button"
            aria-label={`View ${location} on map`}
            className="shrink-0 text-muted-foreground transition-colors hover:text-brand"
          />
        }
      >
        <MapPin className="h-3.5 w-3.5" />
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <LocateFixed className="h-4 w-4 text-brand" />
            {location}
          </SheetTitle>
          <SheetDescription>
            {count} {count === 1 ? "opportunity mentions" : "opportunities mention"} this area.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-4 pb-4">
          {open && <LocationMap location={location} />}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-red-600" /> Exact location
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-500" /> Approximate area
            </span>
          </div>
          <a
            href={googleMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm text-brand underline decoration-dotted underline-offset-4 hover:text-brand/80"
          >
            Open in Google Maps <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </SheetContent>
    </Sheet>
  )
}
