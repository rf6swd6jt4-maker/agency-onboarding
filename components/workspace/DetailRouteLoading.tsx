"use client"

import { useSyncExternalStore } from "react"

import { DetailPageHeader } from "@/components/detail"
import { parseWorkspaceDetailPreview, readWorkspaceDetailPreview, serializeWorkspaceDetailPreview, type WorkspaceDetailPreview } from "@/lib/workspace-detail-preview"

const subscribeToStoredPreview = () => () => undefined

export function DetailRouteLoading({ title, preview: suppliedPreview }: { title: string; preview?: WorkspaceDetailPreview | null }) {
    const suppliedSnapshot = suppliedPreview ? serializeWorkspaceDetailPreview(suppliedPreview) : ""
    const previewSnapshot = useSyncExternalStore(
        subscribeToStoredPreview,
        () => suppliedSnapshot || (() => {
            const stored = readWorkspaceDetailPreview(window.location.pathname)
            return stored ? serializeWorkspaceDetailPreview(stored) : ""
        })(),
        () => suppliedSnapshot,
    )
    const storedPreview = parseWorkspaceDetailPreview(previewSnapshot)

    return <main aria-label={`Opening ${title}`} aria-busy="true" className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6">
        <div className="mx-auto max-w-[92rem]">
            {storedPreview ? <DetailPageHeader
                category={storedPreview.category}
                reference={storedPreview.reference}
                title={storedPreview.title}
                subtitle={storedPreview.subtitle}
                updated={storedPreview.updated ?? "just now"}
            /> : <span className="sr-only">Opening {title}</span>}
        </div>
    </main>
}
