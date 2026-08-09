import Link from "next/link"
import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { ListActionMenu } from "@/components/list/ListActionMenu"
import { ListCreatorAvatar } from "@/components/list/ListCreatorAvatar"
import { ListCreatorBadge } from "@/components/list/ListCreatorBadge"
import { MobileCardActionSurface } from "@/components/list/MobileCardActionSurface"
import { RoundPill, SquarePill, Status } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { MODULES } from "@/lib/onboarding/modules"
import { getOnboardingUrl } from "@/lib/onboarding/custom-domain"
import { getOnboardingStepsForModules } from "@/lib/onboarding/canonical-helpers"
import { getProgressPercentage } from "@/lib/onboarding/progress"
import { SERVICES } from "@/lib/onboarding/services"
import { isOnboardingStuck } from "@/lib/onboarding/stuck"
import { profileAvatarUrl } from "@/lib/profile-avatar"
import {
    onboardingDetailHref,
    listRelationshipsForWorkspace,
} from "@/lib/relationships"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
}

function metadataSessionId(metadata: unknown) {
    return metadata && typeof metadata === "object" && "session_id" in metadata
        ? String((metadata as Record<string, unknown>).session_id ?? "")
        : ""
}

function metadataStepKey(metadata: unknown) {
    return metadata && typeof metadata === "object" && "step_key" in metadata
        ? String((metadata as Record<string, unknown>).step_key ?? "")
        : ""
}

export default async function RelationshipOnboardingPage({ params }: PageProps) {
    const { workspaceSlug } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug)
    const [
        relationships,
        { data: sessions },
        { data: workItems },
        { data: assets },
        { data: modules },
        { data: services },
    ] = await Promise.all([
        listRelationshipsForWorkspace(workspace.id),
        supabaseAdmin
            .from("relationship_onboarding_sessions")
            .select("id, relationship_id, status, session_token, is_test, created_by, created_at, updated_at, completed_at")
            .eq("workspace_id", workspace.id)
            .in("status", ["active", "completed"])
            .order("updated_at", { ascending: false }),
        supabaseAdmin
            .from("work_items")
            .select("id, status, metadata, updated_at, created_at")
            .eq("workspace_id", workspace.id)
            .eq("native_kind", "onboarding_step")
            .order("created_at", { ascending: true })
            .limit(1000),
        supabaseAdmin
            .from("assets")
            .select("id, asset_kind, native_kind, metadata, updated_at, created_at")
            .eq("workspace_id", workspace.id)
            .in("native_kind", ["onboarding_form_submission", "onboarding_upload"])
            .order("updated_at", { ascending: false })
            .limit(1000),
        supabaseAdmin
            .from("relationship_onboarding_modules")
            .select("relationship_id, module_key")
            .eq("workspace_id", workspace.id)
            .order("created_at", { ascending: true }),
        supabaseAdmin
            .from("relationship_services")
            .select("relationship_id, service_key")
            .eq("workspace_id", workspace.id)
            .order("created_at", { ascending: true }),
    ])

    const relationshipById = new Map(relationships.map((relationship) => [relationship.id, relationship]))
    const activeSessionByRelationship = new Map<string, NonNullable<typeof sessions>[number]>()
    for (const session of sessions ?? []) {
        if (!activeSessionByRelationship.has(session.relationship_id)) {
            activeSessionByRelationship.set(session.relationship_id, session)
        }
    }

    const moduleKeysByRelationship = new Map<string, string[]>()
    for (const onboardingModule of modules ?? []) {
        moduleKeysByRelationship.set(onboardingModule.relationship_id, [...(moduleKeysByRelationship.get(onboardingModule.relationship_id) ?? []), onboardingModule.module_key])
    }
    const serviceKeysByRelationship = new Map<string, string[]>()
    for (const service of services ?? []) {
        serviceKeysByRelationship.set(service.relationship_id, [...(serviceKeysByRelationship.get(service.relationship_id) ?? []), service.service_key])
    }

    const workItemsBySession = new Map<string, NonNullable<typeof workItems>>()
    for (const item of workItems ?? []) {
        const sessionId = metadataSessionId(item.metadata)
        if (!sessionId) continue
        workItemsBySession.set(sessionId, [...(workItemsBySession.get(sessionId) ?? []), item])
    }

    const assetsBySession = new Map<string, { submissions: number; uploads: number; latest: string | null }>()
    for (const asset of assets ?? []) {
        const sessionId = metadataSessionId(asset.metadata)
        if (!sessionId) continue
        const existing = assetsBySession.get(sessionId) ?? { submissions: 0, uploads: 0, latest: null }
        const latest = asset.updated_at ?? asset.created_at ?? null
        assetsBySession.set(sessionId, {
            submissions: existing.submissions + (asset.native_kind === "onboarding_form_submission" ? 1 : 0),
            uploads: existing.uploads + (asset.native_kind === "onboarding_upload" ? 1 : 0),
            latest: latest && (!existing.latest || new Date(latest) > new Date(existing.latest)) ? latest : existing.latest,
        })
    }

    const rows = [...activeSessionByRelationship.values()]
        .map((session) => {
            const relationship = relationshipById.get(session.relationship_id)
            if (!relationship) return null
            const items = workItemsBySession.get(session.id) ?? []
            const steps = getOnboardingStepsForModules(moduleKeysByRelationship.get(session.relationship_id) ?? [])
            const completedKeys = items.filter((item) => item.status === "done").map((item) => metadataStepKey(item.metadata)).filter(Boolean)
            const percentage = getProgressPercentage(steps, completedKeys)
            const latestWork = items.reduce<string | null>((latest, item) => {
                const date = item.updated_at ?? item.created_at ?? null
                return date && (!latest || new Date(date) > new Date(latest)) ? date : latest
            }, null)
            const assetSummary = assetsBySession.get(session.id) ?? { submissions: 0, uploads: 0, latest: null }
            const latestActivity = [assetSummary.latest, latestWork, session.updated_at]
                .filter((date): date is string => Boolean(date))
                .reduce((latest, date) => new Date(date) > new Date(latest) ? date : latest)
            const stuck = isOnboardingStuck({ percentage, createdAt: session.created_at, lastActivityAt: latestActivity })
            return {
                relationship,
                session,
                completedCount: Math.min(steps.length, completedKeys.length),
                missingCount: Math.max(0, steps.length - completedKeys.length),
                stuck,
                latestActivity,
                assetSummary,
            }
        })
        .filter((row): row is NonNullable<typeof row> => Boolean(row))
    const creatorIds = [...new Set(rows.map((row) => row.session.created_by).filter((id): id is string => Boolean(id)))]
    const { data: creators } = creatorIds.length
        ? await supabaseAdmin.from("user_profiles").select("user_id, username, avatar_path").in("user_id", creatorIds)
        : { data: [] as Array<{ user_id: string; username: string; avatar_path: string | null }> }
    const creatorById = new Map((creators ?? []).map((creator) => [creator.user_id, creator]))

    return (
        <main className="min-h-screen bg-neutral-950 px-4 pb-7 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-7xl pt-5">
                <WorkspaceBanner bannerPath={workspace.banner_path} logoPath={workspace.logo_path} name={workspace.name} height={workspace.banner_height} position={workspace.banner_position} />
                <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight">Onboarding</h1>
                        <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">
                            Relationships in onboarding, their step progress, submissions, and uploaded assets.
                        </p>
                    </div>
                </header>

                <section className="mt-5 grid grid-cols-3 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 sm:gap-3 sm:overflow-visible sm:rounded-none sm:border-0 sm:bg-transparent">
                    {[
                        ["Active", rows.filter((row) => row.session.status === "active").length],
                        ["Complete", rows.filter((row) => row.session.status === "completed").length],
                        ["Stuck", rows.filter((row) => row.stuck).length],
                    ].map(([label, value]) => (
                        <div key={label} className="border-r border-neutral-800 px-3 py-3 last:border-r-0 sm:rounded-lg sm:border sm:border-neutral-800 sm:bg-neutral-900">
                            <p className="text-[10px] leading-tight text-neutral-500 sm:text-xs">{label}</p>
                            <p className="mt-1 text-lg font-semibold">{value}</p>
                        </div>
                    ))}
                </section>

                <section className="mt-5 space-y-3 2xl:space-y-0 2xl:overflow-hidden 2xl:rounded-2xl 2xl:border 2xl:border-neutral-800 2xl:bg-black">
                    {rows.length ? rows.map(({ relationship, session, completedCount, missingCount, latestActivity, assetSummary }) => {
                        const onboardingHref = onboardingDetailHref(workspace.slug, relationship.id)
                        const title = relationship.business_name
                            ? `${relationship.primary_person_name} – ${relationship.business_name}`
                            : relationship.primary_person_name
                        const creator = session.created_by ? creatorById.get(session.created_by) : null
                        const creatorAvatarSrc = creator?.avatar_path && creator.username ? profileAvatarUrl(creator.username, creator.avatar_path) : null
                        const serviceKeys = serviceKeysByRelationship.get(relationship.id) ?? []
                        const moduleKeys = moduleKeysByRelationship.get(relationship.id) ?? []
                        const actions = [
                            { label: "Open onboarding", href: onboardingHref },
                            { label: "Copy onboarding link", copyText: getOnboardingUrl({
                                workspaceSlug: workspace.slug,
                                sessionToken: session.session_token,
                                customDomain: workspace.custom_onboarding_domain,
                                customDomainVerified: workspace.custom_onboarding_domain_status === "verified",
                            }) },
                        ]
                        const stats = <p className="whitespace-nowrap text-sm text-neutral-500">
                            <span className="text-neutral-200">{completedCount}</span>/{completedCount + missingCount} steps · <span className="text-neutral-200">{assetSummary.submissions}</span> submissions · <span className="text-neutral-200">{assetSummary.uploads}</span> files
                        </p>
                        return <div key={relationship.id} className="2xl:border-b 2xl:border-neutral-900 2xl:last:border-0">
                            <MobileCardActionSurface actions={actions} label={`Open actions for ${relationship.primary_person_name}`} className="rounded-2xl border border-neutral-800 bg-black 2xl:hidden">
                                <div className="flex items-center gap-3 rounded-t-2xl border-b border-neutral-900 bg-neutral-900/35 px-3.5 py-2.5">
                                    <Link href={onboardingHref} className="min-w-0 flex-1 truncate text-base font-medium text-neutral-100 underline decoration-neutral-600 underline-offset-4 hover:text-white">
                                        {title}
                                    </Link>
                                    {session.is_test ? <SquarePill tone="yellow" className="shrink-0">Test</SquarePill> : null}
                                    <Status label="In Progress" tone="yellow" className="shrink-0" />
                                </div>
                                <div className="flex min-w-0 items-center gap-3 overflow-hidden px-3.5 py-2.5">
                                    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                                        {relationship.primary_contact_role ? <span className="mr-1 shrink-0 truncate text-sm text-neutral-400">{relationship.primary_contact_role}</span> : null}
                                        {serviceKeys.map((serviceKey) => <RoundPill key={serviceKey} tone="emerald">{SERVICES[serviceKey]?.title ?? serviceKey}</RoundPill>)}
                                        {moduleKeys.map((moduleKey) => <RoundPill key={moduleKey} tone="sky">{MODULES[moduleKey]?.title ?? moduleKey}</RoundPill>)}
                                    </div>
                                    {stats}
                                    <div className="flex shrink-0 items-center gap-3">
                                        <p className="font-mono text-xs text-neutral-600">{shortId(relationship.id)}</p>
                                        <p className="whitespace-nowrap text-sm text-neutral-500">{formatRelativeTime(latestActivity)}</p>
                                        <ListCreatorAvatar src={creatorAvatarSrc} username={creator?.username ?? null} className="h-7 w-7 shrink-0" />
                                    </div>
                                </div>
                            </MobileCardActionSurface>

                            <div className="hidden min-h-16 gap-4 px-4 py-2.5 2xl:grid 2xl:grid-cols-[minmax(280px,1.15fr)_120px_230px_minmax(220px,1fr)_190px_32px] 2xl:items-center">
                                <div className="min-w-0">
                                    <div className="flex min-w-0 items-center gap-3">
                                        <Link href={onboardingHref} className="truncate text-base font-medium text-neutral-100 hover:text-white hover:underline hover:decoration-neutral-600 hover:underline-offset-4">{title}</Link>
                                        {session.is_test ? <SquarePill tone="yellow" className="shrink-0">Test</SquarePill> : null}
                                    </div>
                                    {relationship.primary_contact_role ? <p className="mt-1 truncate text-sm text-neutral-400">{relationship.primary_contact_role}</p> : null}
                                </div>
                                <Status label="In Progress" tone="yellow" className="shrink-0" />
                                {stats}
                                <div className="flex min-w-0 flex-wrap gap-1.5">
                                    {serviceKeys.map((serviceKey) => <RoundPill key={serviceKey} tone="emerald">{SERVICES[serviceKey]?.title ?? serviceKey}</RoundPill>)}
                                    {moduleKeys.map((moduleKey) => <RoundPill key={moduleKey} tone="sky">{MODULES[moduleKey]?.title ?? moduleKey}</RoundPill>)}
                                </div>
                                <div className="flex items-center justify-end gap-3">
                                    <p className="font-mono text-xs text-neutral-600">{shortId(relationship.id)}</p>
                                    <p className="whitespace-nowrap text-sm text-neutral-500">{formatRelativeTime(latestActivity)}</p>
                                    <ListCreatorBadge src={creatorAvatarSrc} username={creator?.username ?? null} label="Created by" date={new Date(session.created_at).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })} />
                                </div>
                                <ListActionMenu actions={actions} />
                            </div>
                        </div>
                    }) : (
                        <div className="p-6">
                            <p className="text-lg font-semibold">No relationships are onboarding.</p>
                            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">
                                Start onboarding from a relationship page or create a new relationship directly in the onboarding stage.
                            </p>
                        </div>
                    )}
                </section>
            </div>
        </main>
    )
}
