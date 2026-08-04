"use client"

import { useEffect } from "react"

type ReportableError = Error & { digest?: string }

export function ErrorBoundaryReporter({ error, boundary }: { error: ReportableError; boundary: "app" | "global" }) {
    useEffect(() => {
        console.error(error)
        const path = `${window.location.pathname}${window.location.search}`
        const workspaceSlug = window.location.pathname.split("/").filter(Boolean)[0]
        if (!workspaceSlug) return
        void fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/activity/errors`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                boundary,
                digest: error.digest ?? null,
                message: error.message || "Unexpected application error",
                path,
            }),
            keepalive: true,
        }).catch((reportingError) => {
            console.warn("Could not send application error to Admin Activity", reportingError)
        })
    }, [boundary, error])

    return null
}
