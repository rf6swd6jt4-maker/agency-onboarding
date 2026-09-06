"use client"

import { shortId } from "@/lib/ui/relative-time"
import type { WorkspaceCapability } from "@/lib/workspace-capabilities"
import type { WorkspaceTabRelationshipContext } from "@/lib/workspace-tabs"

function phaseLabel(phase: string) {
    return phase.replace(/_/g, " ")
}

function displayValue(value: string | null | undefined, fallback = "Not saved") {
    return value?.trim() || fallback
}

export function ShellRelationshipContextPanel({ context, workspaceSlug, onNavigate, workspaceCapabilities }: {
    context: WorkspaceTabRelationshipContext
    workspaceSlug: string
    onNavigate: (href: string) => void
    workspaceCapabilities: WorkspaceCapability[]
}) {
    const relationshipHref = `/${workspaceSlug}/relationships/${context.id}`
    const onboardingHref = `/${workspaceSlug}/onboarding/${context.id}`
    const workHref = `/${workspaceSlug}/work/${context.id}`

    return <aside className="fixed right-4 top-[7.75rem] z-[35] hidden h-[calc(100dvh-9.25rem)] w-80 flex-col overflow-hidden overscroll-none rounded-xl border border-neutral-800 bg-neutral-950 text-white shadow-lg shadow-black/20 sm:right-6 lg:flex">
        <div className="shrink-0 px-4 py-3">
            <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-neutral-500">Relationship Context</p>
                <h2 className="truncate text-sm font-semibold">{context.primary_person_name}</h2>
                <p className="mt-1 font-mono text-xs text-neutral-600">{shortId(context.id)}</p>
            </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-none border-t border-neutral-900 px-4 py-4">
            <section>
                <p className="text-xs uppercase tracking-wide text-neutral-500">Relationship</p>
                <dl className="mt-3 space-y-3 text-sm">
                    <div><dt className="text-neutral-500">Company</dt><dd className="mt-1 text-neutral-100">{displayValue(context.business_name)}</dd></div>
                    <div><dt className="text-neutral-500">Lifecycle</dt><dd className="mt-1 capitalize text-neutral-100">{phaseLabel(context.lifecycle_phase)}</dd></div>
                    <div><dt className="text-neutral-500">Role</dt><dd className="mt-1 text-neutral-100">{displayValue(context.primary_contact_role)}</dd></div>
                </dl>
            </section>

            <section className="mt-5 border-t border-neutral-900 pt-4">
                <p className="text-xs uppercase tracking-wide text-neutral-500">Contact</p>
                <dl className="mt-3 space-y-3 text-sm">
                    <div><dt className="text-neutral-500">Phone</dt><dd className="mt-1 text-neutral-100">{displayValue(context.primary_phone)}</dd></div>
                    <div><dt className="text-neutral-500">Email</dt><dd className="mt-1 truncate text-neutral-100">{displayValue(context.primary_email)}</dd></div>
                    <div><dt className="text-neutral-500">Website</dt><dd className="mt-1 truncate text-neutral-100">{displayValue(context.website_url)}</dd></div>
                </dl>
            </section>

            <section className="mt-5 border-t border-neutral-900 pt-4">
                <p className="text-xs uppercase tracking-wide text-neutral-500">Context</p>
                <dl className="mt-3 space-y-3 text-sm">
                    <div><dt className="text-neutral-500">Industry</dt><dd className="mt-1 capitalize text-neutral-100">{displayValue(context.industry_value?.replace(/_/g, " "))}</dd></div>
                    <div><dt className="text-neutral-500">Location</dt><dd className="mt-1 capitalize text-neutral-100">{displayValue(context.location_value?.replace(/_/g, " "))}</dd></div>
                    <div><dt className="text-neutral-500">Source</dt><dd className="mt-1 text-neutral-100">{displayValue(context.source_label)}</dd></div>
                </dl>
                {context.notes_summary ? <p className="mt-4 rounded-lg border border-neutral-800 bg-black px-3 py-2 text-sm leading-6 text-neutral-300">{context.notes_summary}</p> : null}
            </section>

            {context.metrics.length ? <section className="mt-5 border-t border-neutral-900 pt-4">
                <p className="text-xs uppercase tracking-wide text-neutral-500">Current view</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                    {context.metrics.map((metric) => <div key={metric.label} className="rounded-lg border border-neutral-800 bg-black px-3 py-2">
                        <p className="text-xs text-neutral-500">{metric.label}</p>
                        <p className="mt-1 text-sm font-medium text-neutral-100">{metric.value}</p>
                    </div>)}
                </div>
            </section> : null}

            <section className="mt-5 border-t border-neutral-900 pt-4">
                <p className="text-xs uppercase tracking-wide text-neutral-500">Open</p>
                <div className="mt-3 grid gap-2 text-sm">
                    {workspaceCapabilities.includes("relationships.view") ? <button type="button" onClick={() => onNavigate(relationshipHref)} className="rounded-lg border border-neutral-800 px-3 py-2 text-left text-neutral-300 hover:border-neutral-600 hover:text-white">Relationship summary</button> : null}
                    {workspaceCapabilities.includes("onboarding.manage") ? <button type="button" onClick={() => onNavigate(onboardingHref)} className="rounded-lg border border-neutral-800 px-3 py-2 text-left text-neutral-300 hover:border-neutral-600 hover:text-white">Onboarding</button> : null}
                    {workspaceCapabilities.includes("fulfilment.manage") ? <button type="button" onClick={() => onNavigate(workHref)} className="rounded-lg border border-neutral-800 px-3 py-2 text-left text-neutral-300 hover:border-neutral-600 hover:text-white">Fulfilment</button> : null}
                </div>
            </section>
        </div>
    </aside>
}
