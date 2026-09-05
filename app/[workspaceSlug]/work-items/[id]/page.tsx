import Link from "next/link"
import { notFound } from "next/navigation"
import { DetailDangerAction, DetailDangerButton, DetailDangerZone, DetailPageHeader } from "@/components/detail"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { ClientContextPanel } from "@/components/workspace/ClientContextPanel"
import { workItemStatusPresentation } from "@/components/list/work-item-presentation"
import { SquarePill } from "@/components/ui"
import {
    getWorkItem,
    getWorkItemPlanningContext,
    getRelationship,
    listWorkItemRelationships,
    listWorkItemAssets,
    assetHref,
} from "@/lib/relationships"
import { createUploadSignedUrls } from "@/lib/onboarding/uploads"
import { listWorkItemKeyResultLinks } from "@/lib/admin/okrs"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { accessibleRelationshipIds, accessibleWorkItemIds, requireWorkspaceAccess, workspaceAccessHasCapability } from "@/lib/workspace-access"
import { InlineWorkItemFields } from "./InlineWorkItemFields"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string; id: string }>
}

export default async function WorkItemDetailPage({ params }: PageProps) {
    const { workspaceSlug, id } = await params
    const { workspace, user, role, access } = await requireWorkspaceAccess(workspaceSlug)
    if (!workspaceAccessHasCapability(access, "fulfilment.manage") && !workspaceAccessHasCapability(access, "onboarding.manage")) notFound()
    const [item, allowedRelationshipIds, allowedWorkItemIds] = await Promise.all([
        getWorkItem(workspace.id, id),
        accessibleRelationshipIds(access),
        accessibleWorkItemIds(access),
    ])
    if (allowedWorkItemIds && !allowedWorkItemIds.has(id)) notFound()
    if (!item) notFound()
    const status = workItemStatusPresentation(item.status)
    if (item.visibility === "admins_only" && role === "staff") notFound()
    const isAdminItem = item.area === "admin"
    const canSeeOkrs = role !== "staff"
    const [relationships, assets, planning, keyResultLinks] = await Promise.all([
        isAdminItem ? Promise.resolve([]) : listWorkItemRelationships(workspace.id, item.id),
        isAdminItem ? Promise.resolve([]) : listWorkItemAssets(workspace.id, item.id),
        getWorkItemPlanningContext(workspace.id, item, { includeAvailableWorkItems: false }),
        canSeeOkrs ? listWorkItemKeyResultLinks(workspace.id, item.id) : Promise.resolve([]),
    ])
    planning.dependencies = planning.dependencies.filter((dependency) => !allowedWorkItemIds || allowedWorkItemIds.has(dependency.work_item_id))
    if (planning.parent && allowedWorkItemIds && !allowedWorkItemIds.has(planning.parent.id)) planning.parent = null
    const scopedRelationships = relationships.filter((relationship) => !allowedRelationshipIds || allowedRelationshipIds.has(relationship.relationship_id))
    const contextRelationshipId = scopedRelationships[0]?.relationship_id
    const waitsForParent = planning.dependencies.some((dependency) => dependency.source === "parent_auto" && dependency.work_item_id === item.parent_work_item_id)
    const [contextRelationship, avatarUrls] = await Promise.all([
        contextRelationshipId ? getRelationship(workspace.id, contextRelationshipId) : Promise.resolve(null),
        createUploadSignedUrls([...planning.members, ...(planning.creator ? [planning.creator] : [])].map((person) => person.avatar_path).filter((path): path is string => Boolean(path))),
    ])
    const personProps = (person: typeof planning.members[number]) => ({
        user_id: person.user_id,
        username: person.username,
        avatar_url: person.avatar_path ? avatarUrls.get(person.avatar_path) ?? null : null,
    })

    return (
        <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} workspaceAccess={access} currentProduct="client-work" />
            <div className="mx-auto max-w-[92rem]">
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="min-w-0">
                        <DetailPageHeader
                            category="Work item"
                            reference={shortId(item.id)}
                            title={item.title}
                            labels={isAdminItem ? <SquarePill>Admin</SquarePill> : null}
                            updated={formatRelativeTime(item.updated_at)}
                        />

                <InlineWorkItemFields
                    workspaceSlug={workspace.slug} workItemId={item.id} status={item.status} statusLabel={status.label} statusTone={status.tone}
                    updatedAt={item.updated_at}
                    plannedStartDate={item.planned_start_date} plannedStartTime={item.planned_start_time ?? null} dueDate={item.due_date} dueTime={item.due_time ?? null} actualStartAt={item.actual_start_at} actualStartHasTime={Boolean(item.actual_start_has_time)} actualCompletedAt={item.actual_completed_at} actualCompletedHasTime={Boolean(item.actual_completed_has_time)} description={item.description}
                    assignees={planning.assignees.map(personProps)} executionOwnerId={item.execution_owner_id ?? null} creator={planning.creator ? personProps(planning.creator) : null} members={planning.members.map(personProps)}
                    parent={planning.parent ? { id: planning.parent.id, title: planning.parent.title, status: planning.parent.status } : null} parentId={item.parent_work_item_id ?? null} waitsForParent={waitsForParent}
                    dependencies={planning.dependencies.flatMap((dependency) => dependency.work_item ? [dependency.work_item] : [])}
                    manualDependencyIds={planning.dependencies.filter((dependency) => dependency.source === "manual").map((dependency) => dependency.work_item_id)}
                    workOptions={[]}
                    relationships={scopedRelationships.map((link) => ({ id: link.relationship_id, label: link.relationship?.business_name ?? link.relationship?.primary_person_name ?? "Relationship" }))}
                    relationshipOptions={[]}
                    relationshipsLocked={isAdminItem || item.native_kind === "onboarding_step"} priorityOverride={item.priority_override ?? null}
                    keyResults={keyResultLinks.map((result) => ({ ...result, code: `KR-${shortId(result.id)}` }))}
                    keyResultOptions={[]}
                    editorOptionsHref={`/api/workspaces/${encodeURIComponent(workspace.slug)}/work-items/${encodeURIComponent(item.id)}/editor-options`}
                    linksLocked={item.native_kind === "onboarding_step"}
                />

                <section className="mt-6 rounded-2xl border border-neutral-800 bg-black p-5">
                    <h2 className="text-lg font-semibold">Assets and updates</h2>
                    <div className="mt-4 divide-y divide-neutral-900 rounded-xl border border-neutral-900">
                        {assets.length ? assets.map((asset) => (
                            <Link key={asset.id} href={assetHref(workspace.slug, asset.id)} className="grid gap-2 px-3 py-3 hover:bg-neutral-900/70 sm:grid-cols-[1fr_120px] sm:items-center">
                                <div className="min-w-0">
                                    <p className="truncate font-medium text-neutral-100">{asset.title}</p>
                                    <p className="mt-1 font-mono text-xs text-neutral-600">{shortId(asset.id)}</p>
                                </div>
                                <p className="text-sm text-neutral-500 sm:text-right">{formatRelativeTime(asset.updated_at)}</p>
                            </Link>
                        )) : (
                            <p className="px-3 py-4 text-sm text-neutral-500">No assets are attached to this work item yet.</p>
                        )}
                    </div>
                </section>

                        {role === "owner" || role === "admin" ? <DetailDangerZone>
                            <DetailDangerAction
                                title="Archive work item"
                                description="Archive will remove this item from active work lists while retaining its schedule, links, updates, and history."
                                control={<DetailDangerButton type="button" disabled>Archive work item</DetailDangerButton>}
                            />
                            <DetailDangerAction
                                title="Delete work item permanently"
                                description="Permanent deletion will be enabled after archive storage and dependency safeguards are implemented."
                                control={<DetailDangerButton type="button" tone="delete" disabled>Delete permanently</DetailDangerButton>}
                            />
                        </DetailDangerZone> : null}
                    </div>

                    <ClientContextPanel
                        workspaceSlug={workspace.slug}
                        relationship={contextRelationship}
                        allowedDestinations={role === "staff" ? [
                            ...(workspaceAccessHasCapability(access, "onboarding.manage") ? ["onboarding" as const] : []),
                            ...(workspaceAccessHasCapability(access, "fulfilment.manage") ? ["fulfilment" as const] : []),
                        ] : undefined}
                        metrics={[
                            { label: "Status", value: status.label },
                            { label: "Assets", value: assets.length },
                        ]}
                    />
                </div>
            </div>
        </main>
    )
}
