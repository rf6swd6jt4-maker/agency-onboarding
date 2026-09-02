import Link from "next/link"
import { notFound } from "next/navigation"
import { DetailDangerAction, DetailDangerButton, DetailDangerZone, DetailField, DetailFields, DetailPageHeader } from "@/components/detail"
import { RelationshipStage, SquarePill, Status } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { ClientContextPanel } from "@/components/workspace/ClientContextPanel"
import {
    getRelationship,
    listRelationshipTimelineItems,
    phaseLabel,
    relationshipHubHref,
    workItemHref,
} from "@/lib/relationships"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { accessibleWorkItemIds, requireRelationshipAccess, requireWorkspacePanel } from "@/lib/workspace-access"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string; relationshipId: string }>
}

export default async function FulfilmentDetailPlaceholder({ params }: PageProps) {
    const { workspaceSlug, relationshipId } = await params
    const { workspace, user, role, access } = await requireWorkspacePanel(workspaceSlug, "fulfilment")
    await requireRelationshipAccess(access, relationshipId)
    const relationship = await getRelationship(workspace.id, relationshipId)
    if (!relationship) notFound()
    const allWorkItems = await listRelationshipTimelineItems(workspace.slug, relationship)
    const allowedWorkItemIds = await accessibleWorkItemIds(access, new Set([relationship.id]))
    const workItems = allWorkItems.filter((item) => (
        !allowedWorkItemIds
        || allowedWorkItemIds.has(item.id)
        || Boolean(item.synthesized && item.lifecycle_phase === "fulfilment")
    ))
    const openItems = workItems.filter((item) => !["done", "canceled"].includes(item.status))

    return (
        <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-[92rem]">
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="min-w-0">
                        <DetailPageHeader
                            category="Fulfilment"
                            reference={shortId(relationship.id)}
                            title={relationship.primary_person_name}
                            subtitle={relationship.business_name ?? "No company saved"}
                            labels={relationship.source_metadata.is_test === true ? <SquarePill tone="yellow">Test</SquarePill> : null}
                            updated={formatRelativeTime(relationship.updated_at)}
                        />

                        <DetailFields>
                            <DetailField label="Status" icon="status"><Status label={openItems.length ? "In progress" : "No open work"} tone={openItems.length ? "yellow" : "grey"} /></DetailField>
                            <DetailField label="Lifecycle" icon="timeline" className="lg:border-l lg:border-neutral-900 lg:pl-8"><RelationshipStage phase={relationship.lifecycle_phase} /></DetailField>
                            <DetailField label="Open work" icon="activity">{openItems.length}</DetailField>
                            <DetailField label="Updated" icon="time" className="lg:border-l lg:border-neutral-900 lg:pl-8">{formatRelativeTime(relationship.updated_at)}</DetailField>
                        </DetailFields>

                <section className="mt-6 rounded-2xl border border-neutral-800 bg-black p-5">
                    <h2 className="text-lg font-semibold">Future fulfilment workspace</h2>
                    <p className="mt-2 text-sm leading-6 text-neutral-400">
                        Placeholder for relationship fulfilment tasks, blockers, due dates, assigned work, assets, and links to global work-item detail panels.
                    </p>
                    <div className="mt-4 divide-y divide-neutral-900 rounded-xl border border-neutral-900">
                        {openItems.slice(0, 6).map((item) => (
                            <Link key={item.id} href={item.synthesized ? item.native_href ?? workItemHref(workspace.slug, item.id) : workItemHref(workspace.slug, item.id)} className="block px-3 py-2 hover:bg-neutral-900/70">
                                <p className="text-sm font-medium text-neutral-100">{item.title}</p>
                                <p className="mt-1 text-xs text-neutral-500">{item.status} · {phaseLabel(item.lifecycle_phase)}</p>
                            </Link>
                        ))}
                        {openItems.length === 0 && (
                            <p className="px-3 py-4 text-sm text-neutral-500">No open work items are attached yet.</p>
                        )}
                    </div>
                    {role !== "staff" ? <Link href={relationshipHubHref(workspace.slug, relationship.id)} className="mt-4 inline-flex rounded-lg border border-neutral-800 px-3 py-2 text-sm text-neutral-300 hover:text-white">
                        Open relationship summary
                    </Link> : null}
                </section>

                        {role === "owner" || role === "admin" ? <DetailDangerZone>
                            <DetailDangerAction title="Archive fulfilment" description="Archive will remove this fulfilment workspace from active views while preserving linked work and assets." control={<DetailDangerButton type="button" disabled>Archive fulfilment</DetailDangerButton>} />
                            <DetailDangerAction title="Delete fulfilment permanently" description="Permanent deletion will be enabled when fulfilment has an independent archive lifecycle and dependent-record safeguards." control={<DetailDangerButton type="button" tone="delete" disabled>Delete permanently</DetailDangerButton>} />
                        </DetailDangerZone> : null}
                    </div>

                    <ClientContextPanel
                        workspaceSlug={workspace.slug}
                        relationship={relationship}
                        metrics={[{ label: "Open work", value: openItems.length }]}
                        allowedDestinations={role === "staff" ? ["onboarding", "fulfilment"] : undefined}
                    />
                </div>
            </div>
        </main>
    )
}
