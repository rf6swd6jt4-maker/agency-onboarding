"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { shortId } from "@/lib/ui/relative-time"
import {
    WORKSPACE_TAB_FRAME_PARAM,
    WORKSPACE_TAB_MESSAGE_SOURCE,
    workspaceTabContextStorageKey,
    type WorkspaceTabFrameMessage,
    type WorkspaceTabParentMessage,
    type WorkspaceTabRelationshipContext,
} from "@/lib/workspace-tabs"

type RelationshipPhase =
    | "lead"
    | "nurturing"
    | "potential_client"
    | "sold"
    | "invoiced"
    | "onboarding"
    | "onboarding_review"
    | "fulfilment"
    | "retention"
    | "completed_lost"

type ContextRelationship = {
    id: string
    primary_person_name: string
    primary_email: string | null
    primary_phone: string | null
    business_name: string | null
    website_url: string | null
    industry_value: string | null
    location_value: string | null
    source_label: string | null
    primary_contact_role: string | null
    notes_summary: string | null
    lifecycle_phase: RelationshipPhase
}

type ContextMetric = {
    label: string
    value: string | number
}

type Props = {
    workspaceSlug: string
    relationship: ContextRelationship | null
    metrics?: ContextMetric[]
}

function phaseLabel(phase: string) {
    return phase.replace(/_/g, " ")
}

function workspaceHref(workspaceSlug: string, suffix: string) {
    return `/${workspaceSlug}/${suffix.replace(/^\/+/, "")}`
}

function displayValue(value: string | null | undefined, fallback = "Not saved") {
    return value?.trim() || fallback
}

export function ClientContextPanel({ workspaceSlug, relationship, metrics = [] }: Props) {
    const searchParams = useSearchParams()
    const tabId = searchParams.get(WORKSPACE_TAB_FRAME_PARAM) ?? "standalone"
    const storageKey = useMemo(() => workspaceTabContextStorageKey(workspaceSlug, tabId), [tabId, workspaceSlug])
    const [open, setOpen] = useState(() => typeof window === "undefined" ? true : sessionStorage.getItem(storageKey) !== "false")
    const relationshipId = relationship?.id ?? null
    const contextPayload = useMemo<WorkspaceTabRelationshipContext | null>(() => relationship ? {
        ...relationship,
        metrics,
    } : null, [metrics, relationship])

    useEffect(() => {
        sessionStorage.setItem(storageKey, open ? "true" : "false")
    }, [open, storageKey])

    useEffect(() => {
        function receiveHostMessage(event: MessageEvent<WorkspaceTabParentMessage>) {
            if (event.origin !== window.location.origin) return
            const message = event.data
            if (message?.source !== WORKSPACE_TAB_MESSAGE_SOURCE || message.target !== "frame" || message.tabId !== tabId) return
            if (message.type === "context-set" && typeof message.open === "boolean") setOpen(message.open)
        }

        window.addEventListener("message", receiveHostMessage)
        return () => window.removeEventListener("message", receiveHostMessage)
    }, [tabId])

    useEffect(() => {
        if (!relationshipId || !contextPayload || tabId === "standalone" || typeof window === "undefined" || window.parent === window) return

        const postContextStatus = (contextSupported: boolean) => {
            const message: WorkspaceTabFrameMessage = {
                source: WORKSPACE_TAB_MESSAGE_SOURCE,
                target: "host",
                tabId,
                type: "context-status",
                contextSupported,
                relationshipId,
                context: contextSupported ? contextPayload : null,
            }
            window.parent.postMessage(message, window.location.origin)
        }

        postContextStatus(true)
        return () => postContextStatus(false)
    }, [contextPayload, relationshipId, tabId])

    if (!relationship) return null

    const panel = (
        <div className={`fixed right-4 top-6 z-30 flex h-[calc(100dvh-3rem)] w-80 flex-col overflow-hidden overscroll-none rounded-xl border border-neutral-800 bg-neutral-950 text-white shadow-lg shadow-black/20 transition-opacity duration-200 ease-out sm:right-6 ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}>
            <div className="shrink-0 px-4 py-3">
                <div className="min-w-0">
                    <p className="text-xs uppercase tracking-wide text-neutral-500">Relationship Context</p>
                    <h2 className="truncate text-sm font-semibold">{relationship.primary_person_name}</h2>
                    <p className="mt-1 font-mono text-xs text-neutral-600">{shortId(relationship.id)}</p>
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-none border-t border-neutral-900 px-4 py-4">
                <section>
                    <p className="text-xs uppercase tracking-wide text-neutral-500">Relationship</p>
                    <dl className="mt-3 space-y-3 text-sm">
                        <div>
                            <dt className="text-neutral-500">Company</dt>
                            <dd className="mt-1 text-neutral-100">{displayValue(relationship.business_name)}</dd>
                        </div>
                        <div>
                            <dt className="text-neutral-500">Lifecycle</dt>
                            <dd className="mt-1 capitalize text-neutral-100">{phaseLabel(relationship.lifecycle_phase)}</dd>
                        </div>
                        <div>
                            <dt className="text-neutral-500">Role</dt>
                            <dd className="mt-1 text-neutral-100">{displayValue(relationship.primary_contact_role)}</dd>
                        </div>
                    </dl>
                </section>

                <section className="mt-5 border-t border-neutral-900 pt-4">
                    <p className="text-xs uppercase tracking-wide text-neutral-500">Contact</p>
                    <dl className="mt-3 space-y-3 text-sm">
                        <div>
                            <dt className="text-neutral-500">Phone</dt>
                            <dd className="mt-1 text-neutral-100">{displayValue(relationship.primary_phone)}</dd>
                        </div>
                        <div>
                            <dt className="text-neutral-500">Email</dt>
                            <dd className="mt-1 truncate text-neutral-100">{displayValue(relationship.primary_email)}</dd>
                        </div>
                        <div>
                            <dt className="text-neutral-500">Website</dt>
                            <dd className="mt-1 truncate text-neutral-100">{displayValue(relationship.website_url)}</dd>
                        </div>
                    </dl>
                </section>

                <section className="mt-5 border-t border-neutral-900 pt-4">
                    <p className="text-xs uppercase tracking-wide text-neutral-500">Context</p>
                    <dl className="mt-3 space-y-3 text-sm">
                        <div>
                            <dt className="text-neutral-500">Industry</dt>
                            <dd className="mt-1 capitalize text-neutral-100">{displayValue(relationship.industry_value?.replace(/_/g, " "))}</dd>
                        </div>
                        <div>
                            <dt className="text-neutral-500">Location</dt>
                            <dd className="mt-1 capitalize text-neutral-100">{displayValue(relationship.location_value?.replace(/_/g, " "))}</dd>
                        </div>
                        <div>
                            <dt className="text-neutral-500">Source</dt>
                            <dd className="mt-1 text-neutral-100">{displayValue(relationship.source_label)}</dd>
                        </div>
                    </dl>
                    {relationship.notes_summary && (
                        <p className="mt-4 rounded-lg border border-neutral-800 bg-black px-3 py-2 text-sm leading-6 text-neutral-300">
                            {relationship.notes_summary}
                        </p>
                    )}
                </section>

                {metrics.length > 0 && (
                    <section className="mt-5 border-t border-neutral-900 pt-4">
                        <p className="text-xs uppercase tracking-wide text-neutral-500">Current view</p>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                            {metrics.map((metric) => (
                                <div key={metric.label} className="rounded-lg border border-neutral-800 bg-black px-3 py-2">
                                    <p className="text-xs text-neutral-500">{metric.label}</p>
                                    <p className="mt-1 text-sm font-medium text-neutral-100">{metric.value}</p>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                <section className="mt-5 border-t border-neutral-900 pt-4">
                    <p className="text-xs uppercase tracking-wide text-neutral-500">Open</p>
                    <div className="mt-3 grid gap-2 text-sm">
                        <Link href={workspaceHref(workspaceSlug, `relationships/${relationship.id}`)} className="rounded-lg border border-neutral-800 px-3 py-2 text-neutral-300 hover:border-neutral-600 hover:text-white">
                            Relationship summary
                        </Link>
                        <Link href={workspaceHref(workspaceSlug, `onboarding/${relationship.id}`)} className="rounded-lg border border-neutral-800 px-3 py-2 text-neutral-300 hover:border-neutral-600 hover:text-white">
                            Onboarding
                        </Link>
                        <Link href={workspaceHref(workspaceSlug, `work/${relationship.id}`)} className="rounded-lg border border-neutral-800 px-3 py-2 text-neutral-300 hover:border-neutral-600 hover:text-white">
                            Fulfilment
                        </Link>
                    </div>
                </section>
            </div>
        </div>
    )

    return (
        <aside className={`hidden shrink-0 transition-[width,opacity] duration-200 ease-out lg:block ${open ? "w-80 opacity-100" : "w-0 opacity-0 pointer-events-none"}`} aria-hidden={!open}>
            {tabId === "standalone" ? panel : null}
        </aside>
    )
}
