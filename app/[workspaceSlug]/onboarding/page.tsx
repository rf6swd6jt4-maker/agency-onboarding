import Link from "next/link"
import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { ListActionMenu } from "@/components/list/ListActionMenu"
import { ListCreatorBadge } from "@/components/list/ListCreatorBadge"
import { MobileAssignedServices } from "@/components/list/MobileAssignedServices"
import { MobileListActionSurface } from "@/components/list/MobileCardActionSurface"
import { FilterRail, FilterRailCount, FilterRailLink } from "@/components/panel/FilterRail"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { QuickStats } from "@/components/panel/QuickStats"
import { RoundPill, SquarePill, Status } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { MODULES } from "@/lib/onboarding/modules"
import { getOnboardingUrl } from "@/lib/onboarding/custom-domain"
import { getOnboardingStepsForModules } from "@/lib/onboarding/canonical-helpers"
import { getProgressPercentage } from "@/lib/onboarding/progress"
import { relationshipServiceDisplayName, type StoredRelationshipService } from "@/lib/onboarding/service-display"
import { loadOnboardingServiceRevisionDisplays } from "@/lib/onboarding/service-revisions"
import { isOnboardingStuck } from "@/lib/onboarding/stuck"
import { profileAvatarUrl } from "@/lib/profile-avatar"
import {
    onboardingDetailHref,
    listRelationshipsForWorkspace,
    workspaceHref,
} from "@/lib/relationships"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
    searchParams: Promise<{ state?: string }>
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

export default async function RelationshipOnboardingPage({ params, searchParams }: PageProps) {
    const [{ workspaceSlug }, query] = await Promise.all([params, searchParams])
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
            .select("relationship_id, service_key, service_revision_id")
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
    const serviceRevisions = await loadOnboardingServiceRevisionDisplays(workspace.id, (services ?? []).map((service) => service.service_revision_id))
    const servicesByRelationship = new Map<string, Array<StoredRelationshipService & { relationship_id: string }>>()
    for (const service of services ?? []) {
        servicesByRelationship.set(service.relationship_id, [...(servicesByRelationship.get(service.relationship_id) ?? []), service])
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
    const activeRows = rows.filter((row) => row.session.status === "active")
    const completedRows = rows.filter((row) => row.session.status === "completed")
    const stuckRows = rows.filter((row) => row.stuck)
    const selectedState = ["active", "completed", "stuck"].includes(query.state ?? "") ? query.state : null
    const visibleRows = selectedState === "active"
        ? activeRows
        : selectedState === "completed"
            ? completedRows
            : selectedState === "stuck"
                ? stuckRows
                : rows
    const filterHref = (state: string | null) => workspaceHref(workspace.slug, `onboarding${state ? `?state=${state}` : ""}`)

    return (
        <main className="min-h-screen bg-neutral-950 px-4 pb-7 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-7xl pt-5">
                <WorkspaceBanner bannerPath={workspace.banner_path} logoPath={workspace.logo_path} name={workspace.name} height={workspace.banner_height} position={workspace.banner_position} />
                <PanelTabHeader
                    title="Onboarding"
                    description="Relationship onboarding work, submitted information, and assigned delivery setup."
                />

                <QuickStats ariaLabel="Onboarding statistics" items={[
                    { label: "Active", value: activeRows.length },
                    { label: "Complete", value: completedRows.length },
                    { label: "Stuck", value: stuckRows.length },
                ]} />

                <FilterRail ariaLabel="Filter onboarding by state">
                    <FilterRailLink href={filterHref(null)} selected={!selectedState}>All <FilterRailCount>{rows.length}</FilterRailCount></FilterRailLink>
                    <FilterRailLink href={filterHref("active")} selected={selectedState === "active"}>Active <FilterRailCount>{activeRows.length}</FilterRailCount></FilterRailLink>
                    <FilterRailLink href={filterHref("completed")} selected={selectedState === "completed"}>Complete <FilterRailCount>{completedRows.length}</FilterRailCount></FilterRailLink>
                    <FilterRailLink href={filterHref("stuck")} selected={selectedState === "stuck"}>Stuck <FilterRailCount>{stuckRows.length}</FilterRailCount></FilterRailLink>
                </FilterRail>

                <List ariaLabel="Relationship onboarding">
                    {visibleRows.length ? visibleRows.map(({ relationship, session, completedCount, missingCount, stuck, latestActivity, assetSummary }) => {
                        const onboardingHref = onboardingDetailHref(workspace.slug, relationship.id)
                        const title = relationship.business_name
                            ? `${relationship.primary_person_name} – ${relationship.business_name}`
                            : relationship.primary_person_name
                        const creator = session.created_by ? creatorById.get(session.created_by) : null
                        const creatorAvatarSrc = creator?.avatar_path && creator.username ? profileAvatarUrl(creator.username, creator.avatar_path) : null
                        const relationshipServices = servicesByRelationship.get(relationship.id) ?? []
                        const moduleKeys = moduleKeysByRelationship.get(relationship.id) ?? []
                        const serviceLabels = relationshipServices.map((service) => relationshipServiceDisplayName(service, serviceRevisions))
                        const actions = [
                            { label: "Open onboarding", href: onboardingHref },
                            { label: "Copy onboarding link", copyText: getOnboardingUrl({
                                workspaceSlug: workspace.slug,
                                sessionToken: session.session_token,
                                customDomain: workspace.custom_onboarding_domain,
                                customDomainVerified: workspace.custom_onboarding_domain_status === "verified",
                            }) },
                        ]
                        const stats = <span className="whitespace-nowrap text-neutral-500">
                            <span className="text-neutral-200">{completedCount}</span>/{completedCount + missingCount} steps · <span className="text-neutral-200">{assetSummary.submissions}</span> submissions · <span className="text-neutral-200">{assetSummary.uploads}</span> files
                        </span>
                        return <ListItem key={relationship.id}>
                            <MobileListActionSurface actions={actions} label={`Open actions for ${relationship.primary_person_name}`}>
                                <ListPrimaryRow>
                                    <ListTitle href={onboardingHref} className="flex-1">{title}</ListTitle>
                                    {session.is_test ? <SquarePill tone="yellow" className="shrink-0">Test</SquarePill> : null}
                                    {stuck ? <SquarePill tone="red" className="shrink-0">Stuck</SquarePill> : null}
                                    <Status label={session.status === "completed" ? "Complete" : "In progress"} tone={session.status === "completed" ? "green" : "yellow"} className="ml-auto shrink-0" />
                                </ListPrimaryRow>
                                <ListSecondaryRow>
                                    <MobileAssignedServices labels={serviceLabels} />
                                    {relationship.primary_contact_role ? <span className="hidden shrink-0 text-neutral-400 xl:inline">{relationship.primary_contact_role}</span> : null}
                                    <span className="hidden shrink-0 sm:inline">{stats}</span>
                                    <div className="hidden min-w-0 items-center gap-1.5 overflow-hidden lg:flex">
                                    {relationshipServices.map((service) => <RoundPill key={`${service.service_key}:${service.service_revision_id ?? "legacy"}`} tone="emerald">{relationshipServiceDisplayName(service, serviceRevisions)}</RoundPill>)}
                                    {moduleKeys.map((moduleKey) => <RoundPill key={moduleKey} tone="sky">{MODULES[moduleKey]?.title ?? moduleKey}</RoundPill>)}
                                    </div>
                                    {relationshipServices.length === 0 ? <span className="hidden text-neutral-500 sm:inline">No assigned services</span> : null}
                                    <ListTrailing>
                                        <span className="font-mono text-neutral-500">{shortId(relationship.id)}</span>
                                        <span className="whitespace-nowrap text-neutral-500">{formatRelativeTime(latestActivity)}</span>
                                        <ListCreatorBadge src={creatorAvatarSrc} username={creator?.username ?? null} label="Created by" date={new Date(session.created_at).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })} />
                                        <ListActionMenu actions={actions} className="hidden sm:block" />
                                    </ListTrailing>
                                </ListSecondaryRow>
                            </MobileListActionSurface>
                        </ListItem>
                    }) : (
                        <div className="p-6">
                            <p className="text-lg font-semibold">{selectedState ? `No ${selectedState} onboarding relationships.` : "No relationships are onboarding."}</p>
                            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">
                                {selectedState ? <>Choose another state or <Link href={filterHref(null)} className="text-neutral-200 underline decoration-neutral-600 underline-offset-4 hover:text-white">show all onboarding relationships</Link>.</> : "Start onboarding from a relationship page or create a new relationship directly in the onboarding stage."}
                            </p>
                        </div>
                    )}
                </List>
            </div>
        </main>
    )
}
