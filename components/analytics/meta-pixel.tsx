"use client"

import Script from "next/script"
import { usePathname, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useRef } from "react"
import { trackPixelPageView } from "@/lib/pixel"

/**
 * The Meta Pixel, mounted once in the root layout.
 *
 * Renders nothing at all unless NEXT_PUBLIC_META_PIXEL_ID is set, so local
 * development and any deployment without an ad account stay clean — no script,
 * no beacon, no console noise. The env var has to be NEXT_PUBLIC_ because the
 * id is read in the browser; that is fine, a pixel id is public by nature and
 * visible in the network tab of every site that runs one.
 *
 * If events stop arriving, check the CSP in next.config.ts first. A pixel
 * blocked by CSP fails silently — see the note there.
 */

function PixelPageViews() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // The base snippet already fires PageView on load, so firing again on the
  // first render would double-count every landing — and the landing page is
  // the denominator of the whole funnel. Skip the first pass; report only
  // navigations after it.
  const seenFirst = useRef(false)

  useEffect(() => {
    if (!seenFirst.current) {
      seenFirst.current = true
      return
    }
    trackPixelPageView()
  }, [pathname, searchParams])

  return null
}

export function MetaPixel() {
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID

  if (!pixelId) return null

  return (
    <>
      <Script id="meta-pixel" strategy="afterInteractive">
        {`!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window,document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${pixelId}');
fbq('track', 'PageView');`}
      </Script>

      {/* useSearchParams needs a Suspense boundary or it opts the whole
          route out of static rendering. */}
      <Suspense fallback={null}>
        <PixelPageViews />
      </Suspense>
    </>
  )
}
