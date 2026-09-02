/* eslint-disable @next/next/no-img-element */

import Link from "next/link"
import { notFound } from "next/navigation"
import { DetailDangerAction, DetailDangerButton, DetailDangerZone, DetailField, DetailFields, DetailPageHeader } from "@/components/detail"
import { RoundPill, SquarePill } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { ClientContextPanel } from "@/components/workspace/ClientContextPanel"
import {
    getAsset,
    getRelationship,
    listAssetRelationships,
    listAssetWorkItems,
    onboardingDetailHref,
    relationshipHubHref,
    workItemHref,
} from "@/lib/relationships"
import { createUploadSignedUrl } from "@/lib/onboarding/uploads"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { accessibleRelationshipIds, accessibleWorkItemIds, requireAssetAccess, requireWorkspaceAccess, workspaceAccessHasCapability } from "@/lib/workspace-access"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string; id: string }>
}

function formatFileSize(size: number | null) {
    if (!size) return "Unknown size"
    if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
    return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function isImage(contentType: string | null) {
    return Boolean(contentType?.startsWith("image/"))
}

function isVideo(contentType: string | null) {
    return Boolean(contentType?.startsWith("video/"))
}

function isAudio(contentType: string | null) {
    return Boolean(contentType?.startsWith("audio/"))
}

function isPdf(contentType: string | null, title: string) {
    return contentType === "application/pdf" || title.toLowerCase().endsWith(".pdf")
}

function responseEntries(metadata: Record<string, unknown>) {
    const response = metadata.response
    if (!response || typeof response !== "object" || Array.isArray(response)) return []
    return Object.entries(response as Record<string, unknown>).map(([key, value]) => ({
        key,
        value,
    }))
}

function metadataValue(metadata: unknown, key: string) {
    return metadata && typeof metadata === "object" && key in metadata
        ? String((metadata as Record<string, unknown>)[key] ?? "")
        : ""
}

function slugAnchor(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "step"
}

export default async function AssetDetailPage({ params }: PageProps) {
    const { workspaceSlug, id } = await params
    const { workspace, user, role, access } = await requireWorkspaceAccess(workspaceSlug)
    if (!workspaceAccessHasCapability(access, "fulfilment.manage") && !workspaceAccessHasCapability(access, "onboarding.manage")) notFound()
    await requireAssetAccess(access, id)
    const asset = await getAsset(workspace.id, id)
    if (!asset) notFound()
    const [relationships, workItems] = await Promise.all([
        listAssetRelationships(workspace.id, asset.id),
        listAssetWorkItems(workspace.id, asset.id),
    ])
    const allowedRelationshipIds = await accessibleRelationshipIds(access)
    const allowedWorkItemIds = await accessibleWorkItemIds(access, allowedRelationshipIds)
    const scopedRelationships = relationships.filter((relationship) => !allowedRelationshipIds || allowedRelationshipIds.has(relationship.relationship_id))
    const scopedWorkItems = workItems.filter((item) => !allowedWorkItemIds || allowedWorkItemIds.has(item.work_item_id))
    const contextRelationshipId = scopedRelationships[0]?.relationship_id
    const contextRelationship = contextRelationshipId ? await getRelationship(workspace.id, contextRelationshipId) : null
    const previewUrl = asset.storage_path
        ? asset.source_kind === "message"
            ? `/api/client-messages/media/${asset.storage_path.split("/").map(encodeURIComponent).join("/")}`
            : await createUploadSignedUrl(asset.storage_path)
        : asset.external_url
    const formEntries = asset.asset_kind === "form_submission" ? responseEntries(asset.metadata) : []
    const onboardingRelationshipId = metadataValue(asset.metadata, "relationship_id") || contextRelationshipId
    const onboardingStepKey = metadataValue(asset.metadata, "step_key")
    const onboardingBackHref = onboardingRelationshipId && (asset.native_kind === "onboarding_form_submission" || asset.native_kind === "onboarding_upload")
        ? `${onboardingDetailHref(workspace.slug, onboardingRelationshipId)}${onboardingStepKey ? `#step-${slugAnchor(onboardingStepKey)}` : ""}`
        : null

    return (
        <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-[92rem]">
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="min-w-0">
                        <DetailPageHeader
                            category="Asset"
                            reference={shortId(asset.id)}
                            title={asset.title}
                            labels={<SquarePill>{asset.asset_kind.replace(/_/g, " ")}</SquarePill>}
                            facts={[{ label: scopedRelationships.length + scopedWorkItems.length === 1 ? "link" : "links", value: scopedRelationships.length + scopedWorkItems.length }]}
                            updated={formatRelativeTime(asset.updated_at)}
                        />

                        <DetailFields>
                            <DetailField label="Type" icon="file">{asset.content_type ?? asset.asset_kind.replace(/_/g, " ")}</DetailField>
                            <DetailField label="Size" icon="size" className="lg:border-l lg:border-neutral-900 lg:pl-8">{formatFileSize(asset.file_size)}</DetailField>
                            <DetailField label="Source" icon="source">{asset.source_kind.replace(/_/g, " ")}</DetailField>
                            <DetailField label="Reference" icon="identity" className="lg:border-l lg:border-neutral-900 lg:pl-8"><span className="font-mono">{shortId(asset.id)}</span></DetailField>
                            <DetailField label="Relationships" icon="relationship" className="lg:col-span-2">
                                <div className="flex flex-wrap gap-1.5">
                                    {scopedRelationships.length ? scopedRelationships.map((link) => role === "staff" ? <RoundPill key={link.relationship_id} tone="sky">{link.relationship?.business_name ?? link.relationship?.primary_person_name ?? "Relationship"}</RoundPill> : <Link key={link.relationship_id} href={relationshipHubHref(workspace.slug, link.relationship_id)}><RoundPill tone="sky">{link.relationship?.business_name ?? link.relationship?.primary_person_name ?? "Relationship"}</RoundPill></Link>) : <span className="text-neutral-600">Workspace only</span>}
                                </div>
                            </DetailField>
                            <DetailField label="Work items" icon="activity" className="lg:col-span-2">
                                <div className="flex flex-wrap gap-1.5">
                                    {scopedWorkItems.length ? scopedWorkItems.map((link) => <Link key={link.work_item_id} href={workItemHref(workspace.slug, link.work_item_id)}><RoundPill tone="sky">{link.work_item?.title ?? "Work item"}</RoundPill></Link>) : <span className="text-neutral-600">None</span>}
                                </div>
                            </DetailField>
                            <DetailField label="Description" icon="description" className="lg:col-span-2">{asset.description || <span className="text-neutral-600">No description</span>}</DetailField>
                        </DetailFields>

                        {onboardingBackHref ? (
                            <section className="mt-6 rounded-xl border border-sky-500/20 bg-sky-950/10 p-4">
                                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                                    <div>
                                        <p className="text-sm font-medium text-sky-100">Onboarding asset</p>
                                        <p className="mt-1 text-sm leading-6 text-sky-100/70">This asset belongs to a client onboarding chapter.</p>
                                    </div>
                                    <Link href={onboardingBackHref} className="inline-flex min-h-10 items-center rounded-lg border border-sky-300/30 px-3 text-sm text-sky-100 hover:border-sky-200">
                                        Back to onboarding
                                    </Link>
                                </div>
                            </section>
                        ) : null}

                <section className="mt-6">
                    <div className="min-h-[24rem] overflow-hidden rounded-xl border border-neutral-800 bg-black">
                        {formEntries.length > 0 && (
                            <div className="divide-y divide-neutral-900">
                                {formEntries.map((entry) => (
                                    <div key={entry.key} className="px-5 py-4">
                                        <p className="text-sm font-medium capitalize text-neutral-400">{entry.key.replace(/_/g, " ")}</p>
                                        {Array.isArray(entry.value) ? (
                                            <p className="mt-2 text-sm text-neutral-200">{entry.value.length} uploaded file{entry.value.length === 1 ? "" : "s"}</p>
                                        ) : (
                                            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-100">{String(entry.value || "No answer provided")}</p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                        {previewUrl && isImage(asset.content_type) && (
                            <img src={previewUrl} alt={asset.title} className="max-h-[70vh] w-full object-contain" />
                        )}
                        {previewUrl && isVideo(asset.content_type) && (
                            <video controls src={previewUrl} className="max-h-[70vh] w-full bg-black" />
                        )}
                        {previewUrl && isAudio(asset.content_type) && (
                            <div className="flex min-h-[18rem] items-center justify-center p-6">
                                <audio controls src={previewUrl} className="w-full" />
                            </div>
                        )}
                        {previewUrl && isPdf(asset.content_type, asset.title) && (
                            <iframe src={previewUrl} title={asset.title} className="h-[70vh] w-full border-0 bg-white" />
                        )}
                        {previewUrl && !isImage(asset.content_type) && !isVideo(asset.content_type) && !isAudio(asset.content_type) && !isPdf(asset.content_type, asset.title) && (
                            <div className="flex min-h-[24rem] flex-col items-center justify-center px-6 text-center">
                                <p className="text-lg font-semibold">Preview is not available for this file type.</p>
                                <a href={previewUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex min-h-10 items-center rounded-lg bg-white px-4 text-sm font-medium text-black">
                                    Open file
                                </a>
                            </div>
                        )}
                        {!previewUrl && formEntries.length === 0 && (
                            <div className="flex min-h-[24rem] flex-col items-center justify-center px-6 text-center">
                                <p className="text-lg font-semibold">Native asset</p>
                                <p className="mt-2 max-w-md text-sm leading-6 text-neutral-400">
                                    This asset is generated from Betelgeze data and does not have a stored file preview yet.
                                </p>
                            </div>
                        )}
                    </div>
                </section>

                        {role === "owner" || role === "admin" ? <DetailDangerZone>
                            <DetailDangerAction title="Archive asset" description="Archive will remove this asset from active library views while preserving its links and provenance." control={<DetailDangerButton type="button" disabled>Archive asset</DetailDangerButton>} />
                            <DetailDangerAction title="Delete asset permanently" description="Permanent deletion will be enabled after archive storage and linked-record safeguards are implemented." control={<DetailDangerButton type="button" tone="delete" disabled>Delete permanently</DetailDangerButton>} />
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
                            { label: "Reference", value: shortId(asset.id) },
                            { label: "Links", value: scopedRelationships.length + scopedWorkItems.length },
                        ]}
                    />
                </div>
            </div>
        </main>
    )
}
