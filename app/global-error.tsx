"use client"

import { ErrorBoundaryReporter } from "@/components/errors/ErrorBoundaryReporter"

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
    const code = `BGE-${error.digest ?? "UNEXPECTED"}`
    return <html lang="en"><body style={{ margin: 0, background: "#0a0a0a", color: "#fff", fontFamily: "Arial, sans-serif" }}><ErrorBoundaryReporter error={error} boundary="global" /><main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}><section style={{ width: "min(100%, 560px)", border: "1px solid #262626", borderRadius: 16, background: "#171717", padding: 32 }}><p style={{ color: "#a7f3d0", letterSpacing: ".18em", fontSize: 12 }}>BETELGEZE</p><h1>An error has occurred</h1><p style={{ color: "#d4d4d4", lineHeight: 1.6 }}>Close the web app, then open it again and log back in. If the issue persists, report the code below to Betelgeze support.</p><code style={{ display: "inline-block", marginTop: 12, padding: "8px 12px", background: "#0a0a0a", borderRadius: 8, color: "#a7f3d0" }}>{code}</code></section></main></body></html>
}
