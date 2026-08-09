/* eslint-disable @next/next/no-img-element */

import Link from "next/link"
import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { LibraryTabs } from "@/components/library/LibraryTabs"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { QuickStats } from "@/components/panel/QuickStats"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { assetHref, listWorkspaceAssets, workspaceHref, type RelationshipAsset } from "@/lib/relationships"
import { createUploadSignedUrl } from "@/lib/onboarding/uploads"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
}

function formatFileSize(size: number | null) {
    if (!size) return "No file size"
    if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
    return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function isImage(asset: RelationshipAsset) {
    return Boolean(asset.content_type?.startsWith("image/"))
}

export default async function AssetsPage({ params }: PageProps) {
    const { workspaceSlug } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug)
    const assets = await listWorkspaceAssets(workspace.id)
    const imageAssets = assets.filter(isImage)
    const documentCount = assets.filter((asset) => asset.asset_kind === "document" || asset.content_type === "application/pdf").length
    const uploadCount = assets.filter((asset) => asset.source_kind === "upload").length
    const previewEntries = await Promise.all(assets.slice(0, 24).map(async (asset) => ({
        asset,
        previewUrl: isImage(asset) && asset.storage_path ? await createUploadSignedUrl(asset.storage_path) : null,
    })))

    return (
        <main className="min-h-screen bg-neutral-950 px-4 pb-7 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-7xl pt-5">
                <WorkspaceBanner bannerPath={workspace.banner_path} logoPath={workspace.logo_path} name={workspace.name} height={workspace.banner_height} position={workspace.banner_position} />
                <PanelTabHeader
                    title="Assets"
                    description="Workspace files and media available for relationship and work-item use."
                    actions={<Link href={workspaceHref(workspace.slug, "assets?create=asset")} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-4 py-2 text-center text-sm font-medium leading-none text-black sm:min-h-10 sm:px-3">New asset</Link>}
                    tabs={<LibraryTabs workspaceSlug={workspace.slug} active="assets" />}
                />

                <QuickStats ariaLabel="Asset statistics" items={[
                    { label: "Total", value: assets.length, hideOnMobile: true },
                    { label: "Images", value: imageAssets.length },
                    { label: "Documents", value: documentCount },
                    { label: "Uploads", value: uploadCount },
                ]} />

                <section className="mt-5">
                    {previewEntries.length ? (
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                            {previewEntries.map(({ asset, previewUrl }) => (
                                <Link key={asset.id} href={assetHref(workspace.slug, asset.id)} className="group overflow-hidden rounded-xl border border-neutral-800 bg-black hover:border-neutral-600">
                                    <div className="aspect-[4/3] bg-neutral-900">
                                        {previewUrl ? (
                                            <img src={previewUrl} alt={asset.title} className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
                                        ) : (
                                            <div className="h-full bg-neutral-900" />
                                        )}
                                    </div>
                                    <div className="p-4">
                                        <p className="truncate font-medium text-neutral-100">{asset.title}</p>
                                        <p className="mt-1 font-mono text-xs text-neutral-600">{shortId(asset.id)}</p>
                                        <div className="mt-4 flex items-center justify-between gap-3 text-xs text-neutral-500">
                                            <span className="truncate">{formatRelativeTime(asset.updated_at)}</span>
                                            <span className="shrink-0">{formatFileSize(asset.file_size)}</span>
                                        </div>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    ) : (
                        <div className="rounded-2xl border border-neutral-800 bg-black p-6">
                            <p className="text-lg font-semibold">No assets yet.</p>
                            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">
                                Upload files from here or attach assets from relationship and work item pages.
                            </p>
                        </div>
                    )}
                </section>
            </div>
        </main>
    )
}
