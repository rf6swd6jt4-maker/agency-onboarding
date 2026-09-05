"use client"

import { useSyncExternalStore } from "react"

import { DetailPageHeader } from "@/components/detail"
import { parseWorkspaceDetailPreview, readWorkspaceDetailPreview, serializeWorkspaceDetailPreview, type WorkspaceDetailPreview } from "@/lib/workspace-detail-preview"

const subscribeToStoredPreview = () => () => undefined

function Pulse({ className }: { className: string }) {
    return <span aria-hidden="true" className={`block animate-pulse rounded bg-neutral-800 ${className}`} />
}

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

    return <main aria-label={`Loading ${title}`} aria-busy="true" className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6">
        <div className="mx-auto max-w-[92rem]">
            {storedPreview ? <DetailPageHeader
                category={storedPreview.category}
                reference={storedPreview.reference}
                title={storedPreview.title}
                subtitle={storedPreview.subtitle}
                updated={storedPreview.updated ?? "just now"}
            /> : <header className="border-b border-neutral-800 pb-4"><Pulse className="h-3 w-28" /><Pulse className="mt-2 h-7 w-64 max-w-[70vw]" /><Pulse className="mt-2 h-4 w-40" /></header>}
            <div className="mt-5 grid overflow-hidden rounded-2xl border border-neutral-800 bg-black sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <div key={index} className="min-h-20 border-b border-r border-neutral-900 p-4"><Pulse className="h-3 w-20" /><Pulse className="mt-3 h-5 w-32 max-w-full bg-neutral-900" /></div>)}</div>
            <div className="mt-5 min-h-72 animate-pulse rounded-2xl border border-neutral-800 bg-black" />
        </div>
    </main>
}
