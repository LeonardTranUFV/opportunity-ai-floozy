"use client"

/**
 * Last-resort boundary: catches failures in the root layout itself, where the
 * normal error.tsx can't render because the layout that wraps it is what
 * broke. It has to supply its own <html>/<body>, and can't rely on the app's
 * fonts, theme provider or CSS variables loading — hence the inline styles.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b0f14",
          color: "#eaf0f6",
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
          padding: "1rem",
        }}
      >
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 8px" }}>
            Floozy Opportunity AI couldn&apos;t start
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.55, color: "#93a4b5", margin: "0 0 16px" }}>
            Something failed before the app could load. Reloading usually clears it.
          </p>
          {error.digest && (
            <p style={{ fontSize: 11, color: "#5f7183", margin: "0 0 16px" }}>
              Reference: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              cursor: "pointer",
              border: 0,
              borderRadius: 8,
              padding: "9px 18px",
              fontSize: 14,
              fontWeight: 500,
              background: "#eaf0f6",
              color: "#0b0f14",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  )
}
