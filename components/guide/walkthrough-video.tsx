import { PlayCircle } from "lucide-react"

/**
 * Walkthrough video slot on the How It Works page.
 *
 * Deliberately renders a styled placeholder until a real video exists —
 * dropping a `videoUrl` in is the only change needed to go live. Accepts any
 * embeddable URL (YouTube/Vimeo/Loom embed link, or a direct file URL).
 */
export function WalkthroughVideo({ videoUrl, title = "Watch the 2-minute walkthrough" }: { videoUrl?: string; title?: string }) {
  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
      {videoUrl ? (
        <div className="relative aspect-video w-full bg-black">
          <iframe
            src={videoUrl}
            title={title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            className="absolute inset-0 h-full w-full border-0"
          />
        </div>
      ) : (
        <div className="relative flex aspect-video w-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-brand/10 via-brand-2/10 to-emerald-500/10 p-6 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-background/80 shadow-sm ring-1 ring-foreground/10 backdrop-blur">
            <PlayCircle className="size-7 text-brand" />
          </div>
          <div className="flex flex-col gap-1">
            <p className="font-medium">{title}</p>
            <p className="max-w-md text-sm text-muted-foreground">
              A video walkthrough is coming soon. In the meantime, the steps below cover the whole setup.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
