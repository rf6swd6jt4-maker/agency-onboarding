import Link from "next/link"
import { Suspense } from "react"
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
import { relationshipServiceDisplayName, type OnboardingServiceRevisionDisplay, type StoredRelationshipService } from "@/lib/onboarding/service-display"
import { loadOnboardingServiceRevisionDisplays } from "@/lib/onboarding/service-revisions"
import { isOnboardingStuck } from "@/lib/onboarding/stuck"
import { profileAvatarUrl } from "@/lib/profile-avatar"
import {
    onboardingDetailHref,
    listRelationshipsForWorkspace,
    workspaceHref,
    type RelationshipRecord,
} from "@/lib/relationships"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { accessibleRelationshipIds, fullyAccessibleRelationshipIds, requireWorkspacePanel } from "@/lib/workspace-access"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
    searchParams: Promise<{ state?: string }>
}

type OnboardingState = "active" | "completed" | "stuck"
type OnboardingSession = {
    id: string
    relationship_id: string
    status: string
    session_token: string
    is_test: boolean
    created_by: string | null
    created_at: string
    updated_at: string
    completed_at: string | null
}
type OnboardingCoreRow = { relationship: RelationshipRecord; session: OnboardingSession }
type OnboardingCreator = { user_id: string; username: string; avatar_path: string | null }
type OnboardingRowDetails = {
    completedCount: number
    missingCount: number
    stuck: boolean
    latestActivity: string
    assetSummary: { submissions: number; uploads: number; latest: string | null }
}
type OnboardingDetails = {
    rowBySessionId: Map<string, OnboardingRowDetails>
    creatorById: Map<string, OnboardingCreator>
    moduleKeysByRelationship: Map<string, string[]>
    servicesByRelationship: Map<string, Array<StoredRelationshipService & { relationship_id: string }>>
    serviceRevisions: Map<string, OnboardingServiceRevisionDisplay>
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

function metadataSessionStepId(metadata: unknown) {
    return metadata && typeof metadata === "object" && "session_step_id" in metadata
        ? String((metadata as Record<string, unknown>).session_step_id ?? "")
        : ""
}

async function loadOnboardingDetails({ workspaceId, rows, staffMode, allowedServiceIds }: { workspaceId: string; rows: OnboardingCoreRow[]; staffMode: boolean; allowedServiceIds: string[] }): Promise<OnboardingDetails> {
    const sessionIds = rows.map((row) => row.session.id)
    const relationshipIds = [...new Set(rows.map((row) => row.relationship.id))]
    const creatorIds = [...new Set(rows.map((row) => row.session.created_by).filter((id): id is string => Boolean(id)))]
    const empty = <T,>() => Promise.resolve({ data: [] as T[] })
    const [workItemsResult, assetsResult, modulesResult, servicesResult, snapshotModulesResult, snapshotStepsResult, creatorsResult] = await Promise.all([
        sessionIds.length ? supabaseAdmin.from("work_items").select("id, status, metadata, updated_at, created_at").eq("workspace_id", workspaceId).eq("native_kind", "onboarding_step").in("metadata->>session_id", sessionIds).order("created_at", { ascending: true }).limit(1000) : empty<{ id: string; status: string; metadata: unknown; updated_at: string | null; created_at: string }>(),
        sessionIds.length ? supabaseAdmin.from("assets").select("id, asset_kind, native_kind, metadata, updated_at, created_at").eq("workspace_id", workspaceId).in("native_kind", ["onboarding_form_submission", "onboarding_upload"]).in("metadata->>session_id", sessionIds).order("updated_at", { ascending: false }).limit(1000) : empty<{ id: string; asset_kind: string; native_kind: string; metadata: unknown; updated_at: string | null; created_at: string }>(),
        relationshipIds.length ? supabaseAdmin.from("relationship_onboarding_modules").select("relationship_id, module_key").eq("workspace_id", workspaceId).in("relationship_id", relationshipIds).order("created_at", { ascending: true }) : empty<{ relationship_id: string; module_key: string }>(),
        relationshipIds.length ? supabaseAdmin.from("relationship_services").select("relationship_id, service_key, service_id, service_revision_id").eq("workspace_id", workspaceId).in("relationship_id", relationshipIds).order("created_at", { ascending: true }) : empty<{ relationship_id: string; service_key: string; service_id: string | null; service_revision_id: string | null }>(),
        sessionIds.length ? supabaseAdmin.from("relationship_onboarding_session_modules").select("id, session_id, source_kind, source_service_revision_id").eq("workspace_id", workspaceId).in("session_id", sessionIds) : empty<{ id: string; session_id: string; source_kind: string; source_service_revision_id: string | null }>(),
        sessionIds.length ? supabaseAdmin.from("relationship_onboarding_session_steps").select("id, session_id, session_module_id, kind, is_actionable").eq("workspace_id", workspaceId).in("session_id", sessionIds) : empty<{ id: string; session_id: string; session_module_id: string | null; kind: string; is_actionable: boolean | null }>(),
        creatorIds.length ? supabaseAdmin.from("user_profiles").select("user_id, username, avatar_path").in("user_id", creatorIds) : empty<OnboardingCreator>(),
    ])

    const moduleKeysByRelationship = new Map<string, string[]>()
    for (const onboardingModule of modulesResult.data ?? []) {
        moduleKeysByRelationship.set(onboardingModule.relationship_id, [...(moduleKeysByRelationship.get(onboardingModule.relationship_id) ?? []), onboardingModule.module_key])
    }
    const scopedServices = (servicesResult.data ?? []).filter((service) => !staffMode || allowedServiceIds.includes(service.service_id ?? ""))
    const serviceRevisions = await loadOnboardingServiceRevisionDisplays(workspaceId, scopedServices.map((service) => service.service_revision_id))
    const servicesByRelationship = new Map<string, Array<StoredRelationshipService & { relationship_id: string }>>()
    for (const service of scopedServices) servicesByRelationship.set(service.relationship_id, [...(servicesByRelationship.get(service.relationship_id) ?? []), service])

    const scopedServiceRevisionIds = new Set(scopedServices.map((service) => service.service_revision_id).filter((id): id is string => Boolean(id)))
    const scopedSnapshotModuleIds = new Set((snapshotModulesResult.data ?? []).filter((module) => (
        !staffMode || module.source_kind === "mandatory" || Boolean(module.source_service_revision_id && scopedServiceRevisionIds.has(module.source_service_revision_id))
    )).map((module) => module.id))
    const snapshotSteps = snapshotStepsResult.data ?? []
    const snapshotSessionIds = new Set(snapshotSteps.map((step) => step.session_id))
    const scopedSnapshotStepIds = new Set(snapshotSteps.filter((step) => (
        step.is_actionable !== false && step.kind !== "completion" && (!staffMode || !step.session_module_id || scopedSnapshotModuleIds.has(step.session_module_id))
    )).map((step) => step.id))
    const scopedSnapshotStepIdsBySession = new Map<string, string[]>()
    for (const step of snapshotSteps) {
        if (!scopedSnapshotStepIds.has(step.id)) continue
        scopedSnapshotStepIdsBySession.set(step.session_id, [...(scopedSnapshotStepIdsBySession.get(step.session_id) ?? []), step.id])
    }
    const recordIsInScope = (metadata: unknown) => !staffMode || scopedSnapshotStepIds.has(metadataSessionStepId(metadata))
    const workItemsBySession = new Map<string, NonNullable<typeof workItemsResult.data>>()
    for (const item of (workItemsResult.data ?? []).filter((record) => recordIsInScope(record.metadata))) {
        const sessionId = metadataSessionId(item.metadata)
        if (sessionId) workItemsBySession.set(sessionId, [...(workItemsBySession.get(sessionId) ?? []), item])
    }
    const assetsBySession = new Map<string, { submissions: number; uploads: number; latest: string | null }>()
    for (const asset of (assetsResult.data ?? []).filter((record) => recordIsInScope(record.metadata))) {
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
    const rowBySessionId = new Map<string, OnboardingRowDetails>()
    for (const { relationship, session } of rows) {
        const items = workItemsBySession.get(session.id) ?? []
        const snapshotStepIds = scopedSnapshotStepIdsBySession.get(session.id) ?? []
        const steps = snapshotSessionIds.has(session.id)
            ? snapshotStepIds.map((key) => ({ key }))
            : staffMode ? [] : getOnboardingStepsForModules(moduleKeysByRelationship.get(relationship.id) ?? [])
        const completedKeys = items.filter((item) => item.status === "done").map((item) => metadataSessionStepId(item.metadata) || metadataStepKey(item.metadata)).filter(Boolean)
        const percentage = getProgressPercentage(steps, completedKeys)
        const latestWork = items.reduce<string | null>((latest, item) => {
            const date = item.updated_at ?? item.created_at ?? null
            return date && (!latest || new Date(date) > new Date(latest)) ? date : latest
        }, null)
        const assetSummary = assetsBySession.get(session.id) ?? { submissions: 0, uploads: 0, latest: null }
        const latestActivity = [assetSummary.latest, latestWork, session.updated_at].filter((date): date is string => Boolean(date)).reduce((latest, date) => new Date(date) > new Date(latest) ? date : latest)
        rowBySessionId.set(session.id, {
            completedCount: Math.min(steps.length, completedKeys.length),
            missingCount: Math.max(0, steps.length - completedKeys.length),
            stuck: isOnboardingStuck({ percentage, createdAt: session.created_at, lastActivityAt: latestActivity }),
            latestActivity,
            assetSummary,
        })
    }
    return {
        rowBySessionId,
        creatorById: new Map((creatorsResult.data ?? []).map((creator) => [creator.user_id, creator])),
        moduleKeysByRelationship,
        servicesByRelationship,
        serviceRevisions,
    }
}

async function StuckCount({ detailsPromise }: { detailsPromise: Promise<OnboardingDetails> }) {
    const details = await detailsPromise
    return [...details.rowBySessionId.values()].filter((row) => row.stuck).length
}

async function StuckBadge({ sessionId, detailsPromise }: { sessionId: string; detailsPromise: Promise<OnboardingDetails> }) {
    const details = await detailsPromise
    return details.rowBySessionId.get(sessionId)?.stuck ? <SquarePill tone="red" className="shrink-0">Stuck</SquarePill> : null
}

function OnboardingSecondaryFallback() {
    return <ListSecondaryRow className="min-h-[49px]">
        <span aria-hidden="true" className="h-5 w-24 animate-pulse rounded-full bg-neutral-800" />
        <span aria-hidden="true" className="hidden h-4 w-48 animate-pulse rounded bg-neutral-900 sm:inline" />
        <span aria-hidden="true" className="ml-auto h-4 w-24 animate-pulse rounded bg-neutral-900" />
    </ListSecondaryRow>
}

async function OnboardingSecondary({ row, detailsPromise, staffMode, actions }: { row: OnboardingCoreRow; detailsPromise: Promise<OnboardingDetails>; staffMode: boolean; actions: Array<{ label: string; href?: string; copyText?: string }> }) {
    const details = await detailsPromise
    const rowDetails = details.rowBySessionId.get(row.session.id)
    if (!rowDetails) return <OnboardingSecondaryFallback />
    const creator = row.session.created_by ? details.creatorById.get(row.session.created_by) : null
    const creatorAvatarSrc = creator?.avatar_path && creator.username ? profileAvatarUrl(creator.username, creator.avatar_path) : null
    const relationshipServices = details.servicesByRelationship.get(row.relationship.id) ?? []
    const moduleKeys = staffMode ? [] : details.moduleKeysByRelationship.get(row.relationship.id) ?? []
    const serviceLabels = relationshipServices.map((service) => relationshipServiceDisplayName(service, details.serviceRevisions))
    return <ListSecondaryRow>
        <MobileAssignedServices labels={serviceLabels} />
        {row.relationship.primary_contact_role ? <span className="hidden shrink-0 text-neutral-400 xl:inline">{row.relationship.primary_contact_role}</span> : null}
        <span className="hidden shrink-0 whitespace-nowrap text-neutral-500 sm:inline"><span className="text-neutral-200">{rowDetails.completedCount}</span>/{rowDetails.completedCount + rowDetails.missingCount} steps · <span className="text-neutral-200">{rowDetails.assetSummary.submissions}</span> submissions · <span className="text-neutral-200">{rowDetails.assetSummary.uploads}</span> files</span>
        <div className="hidden min-w-0 items-center gap-1.5 overflow-hidden lg:flex">
            {relationshipServices.map((service) => <RoundPill key={`${service.service_key}:${service.service_revision_id ?? "legacy"}`} tone="emerald">{relationshipServiceDisplayName(service, details.serviceRevisions)}</RoundPill>)}
            {moduleKeys.map((moduleKey) => <RoundPill key={moduleKey} tone="sky">{MODULES[moduleKey]?.title ?? moduleKey}</RoundPill>)}
        </div>
        {relationshipServices.length === 0 ? <span className="hidden text-neutral-500 sm:inline">No assigned services</span> : null}
        <ListTrailing>
            <span className="font-mono text-neutral-500">{shortId(row.relationship.id)}</span>
            <span className="whitespace-nowrap text-neutral-500">{formatRelativeTime(rowDetails.latestActivity)}</span>
            <ListCreatorBadge src={creatorAvatarSrc} username={creator?.username ?? null} label="Created by" date={new Date(row.session.created_at).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })} />
            <ListActionMenu actions={actions} className="hidden sm:block" />
        </ListTrailing>
    </ListSecondaryRow>
}

function OnboardingRow({ row, detailsPromise, workspaceSlug, customDomain, customDomainVerified, canCopyLink, staffMode }: { row: OnboardingCoreRow; detailsPromise: Promise<OnboardingDetails>; workspaceSlug: string; customDomain: string | null; customDomainVerified: boolean; canCopyLink: boolean; staffMode: boolean }) {
    const onboardingHref = onboardingDetailHref(workspaceSlug, row.relationship.id)
    const title = row.relationship.business_name ? `${row.relationship.primary_person_name} – ${row.relationship.business_name}` : row.relationship.primary_person_name
    const actions = [
        { label: "Open onboarding", href: onboardingHref },
        ...(canCopyLink ? [{ label: "Copy onboarding link", copyText: getOnboardingUrl({ workspaceSlug, sessionToken: row.session.session_token, customDomain, customDomainVerified }) }] : []),
    ]
    return <ListItem>
        <MobileListActionSurface actions={actions} label={`Open actions for ${row.relationship.primary_person_name}`}>
            <ListPrimaryRow>
                <ListTitle href={onboardingHref} className="flex-1">{title}</ListTitle>
                {row.session.is_test ? <SquarePill tone="yellow" className="shrink-0">Test</SquarePill> : null}
                <Suspense fallback={null}><StuckBadge sessionId={row.session.id} detailsPromise={detailsPromise} /></Suspense>
                <Status label={row.session.status === "completed" ? "Complete" : "In progress"} tone={row.session.status === "completed" ? "green" : "yellow"} className="ml-auto shrink-0" />
            </ListPrimaryRow>
            <Suspense fallback={<OnboardingSecondaryFallback />}><OnboardingSecondary row={row} detailsPromise={detailsPromise} staffMode={staffMode} actions={actions} /></Suspense>
        </MobileListActionSurface>
    </ListItem>
}

function EmptyOnboarding({ selectedState, allHref }: { selectedState: OnboardingState | null; allHref: string }) {
    return <div className="p-6">
        <p className="text-lg font-semibold">{selectedState ? `No ${selectedState} onboarding relationships.` : "No relationships are onboarding."}</p>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">{selectedState ? <>Choose another state or <Link href={allHref} className="text-neutral-200 underline decoration-neutral-600 underline-offset-4 hover:text-white">show all onboarding relationships</Link>.</> : "Start onboarding from a relationship page or create a new relationship directly in the onboarding stage."}</p>
    </div>
}

async function StuckOnboardingRows({ rows, detailsPromise, renderRow, allHref }: { rows: OnboardingCoreRow[]; detailsPromise: Promise<OnboardingDetails>; renderRow: (row: OnboardingCoreRow) => React.ReactNode; allHref: string }) {
    const details = await detailsPromise
    const stuckRows = rows.filter((row) => details.rowBySessionId.get(row.session.id)?.stuck)
    return stuckRows.length ? stuckRows.map(renderRow) : <EmptyOnboarding selectedState="stuck" allHref={allHref} />
}

async function OnboardingPanel({ workspaceId, workspaceSlug, customDomain, customDomainVerified, selectedState, staffMode, allowedServiceIds, relationshipsPromise, sessionsPromise, scopesPromise }: { workspaceId: string; workspaceSlug: string; customDomain: string | null; customDomainVerified: boolean; selectedState: OnboardingState | null; staffMode: boolean; allowedServiceIds: string[]; relationshipsPromise: ReturnType<typeof listRelationshipsForWorkspace>; sessionsPromise: Promise<OnboardingSession[]>; scopesPromise: Promise<[Set<string> | null, Set<string> | null]> }) {
    const [relationships, sessions, [allowedRelationshipIds, fullyAllowedRelationshipIds]] = await Promise.all([relationshipsPromise, sessionsPromise, scopesPromise])
    const relationshipAllowed = (relationshipId: string) => !allowedRelationshipIds || allowedRelationshipIds.has(relationshipId)
    const relationshipById = new Map(relationships.filter((relationship) => relationshipAllowed(relationship.id)).map((relationship) => [relationship.id, relationship]))
    const firstSessionByRelationship = new Map<string, OnboardingSession>()
    for (const session of sessions) if (relationshipAllowed(session.relationship_id) && !firstSessionByRelationship.has(session.relationship_id)) firstSessionByRelationship.set(session.relationship_id, session)
    const rows = [...firstSessionByRelationship.values()].flatMap((session) => {
        const relationship = relationshipById.get(session.relationship_id)
        return relationship ? [{ relationship, session }] : []
    })
    const detailsPromise = loadOnboardingDetails({ workspaceId, rows, staffMode, allowedServiceIds })
    const activeRows = rows.filter((row) => row.session.status === "active")
    const completedRows = rows.filter((row) => row.session.status === "completed")
    const normalVisibleRows = selectedState === "active" ? activeRows : selectedState === "completed" ? completedRows : rows
    const filterHref = (state: string | null) => workspaceHref(workspaceSlug, `onboarding${state ? `?state=${state}` : ""}`)
    const renderRow = (row: OnboardingCoreRow) => <OnboardingRow
        key={row.relationship.id}
        row={row}
        detailsPromise={detailsPromise}
        workspaceSlug={workspaceSlug}
        customDomain={customDomain}
        customDomainVerified={customDomainVerified}
        canCopyLink={!fullyAllowedRelationshipIds || fullyAllowedRelationshipIds.has(row.relationship.id)}
        staffMode={staffMode}
    />

    return <>
        <QuickStats ariaLabel="Onboarding statistics" items={[
            { label: "Active", value: activeRows.length },
            { label: "Complete", value: completedRows.length },
            { label: "Stuck", value: <Suspense fallback="—"><StuckCount detailsPromise={detailsPromise} /></Suspense> },
        ]} />
        <FilterRail ariaLabel="Filter onboarding by state">
            <FilterRailLink href={filterHref(null)} selected={!selectedState}>All <FilterRailCount>{rows.length}</FilterRailCount></FilterRailLink>
            <FilterRailLink href={filterHref("active")} selected={selectedState === "active"}>Active <FilterRailCount>{activeRows.length}</FilterRailCount></FilterRailLink>
            <FilterRailLink href={filterHref("completed")} selected={selectedState === "completed"}>Complete <FilterRailCount>{completedRows.length}</FilterRailCount></FilterRailLink>
            <FilterRailLink href={filterHref("stuck")} selected={selectedState === "stuck"}>Stuck <FilterRailCount><Suspense fallback="—"><StuckCount detailsPromise={detailsPromise} /></Suspense></FilterRailCount></FilterRailLink>
        </FilterRail>
        <List ariaLabel="Relationship onboarding">
            {selectedState === "stuck" ? <Suspense fallback={Array.from({ length: Math.min(4, rows.length || 1) }, (_, index) => <OnboardingListItemFallback key={index} />)}><StuckOnboardingRows rows={rows} detailsPromise={detailsPromise} renderRow={renderRow} allHref={filterHref(null)} /></Suspense> : normalVisibleRows.length ? normalVisibleRows.map(renderRow) : <EmptyOnboarding selectedState={selectedState} allHref={filterHref(null)} />}
        </List>
    </>
}

function OnboardingListItemFallback() {
    return <ListItem>
        <ListPrimaryRow><span className="h-5 w-48 animate-pulse rounded bg-neutral-800" /><span className="ml-auto h-4 w-20 animate-pulse rounded bg-neutral-800" /></ListPrimaryRow>
        <OnboardingSecondaryFallback />
    </ListItem>
}

function OnboardingPanelFallback() {
    return <div aria-label="Loading onboarding" aria-busy="true">
        <QuickStats items={[{ label: "Active", value: "—" }, { label: "Complete", value: "—" }, { label: "Stuck", value: "—" }]} />
        <FilterRail ariaLabel="Loading onboarding filters">{[70, 84, 96, 78].map((width, index) => <span key={index} className="shrink-0 px-2 py-2"><span className="block h-4 animate-pulse rounded bg-neutral-800" style={{ width }} /></span>)}</FilterRail>
        <List ariaLabel="Loading onboarding">{Array.from({ length: 5 }, (_, index) => <OnboardingListItemFallback key={index} />)}</List>
    </div>
}

export default async function RelationshipOnboardingPage({ params, searchParams }: PageProps) {
    const [{ workspaceSlug }, query] = await Promise.all([params, searchParams])
    const { workspace, user, access } = await requireWorkspacePanel(workspaceSlug, "onboarding")
    const selectedState = (["active", "completed", "stuck"] as const).includes(query.state as OnboardingState) ? query.state as OnboardingState : null
    const scopesPromise = Promise.all([accessibleRelationshipIds(access), fullyAccessibleRelationshipIds(access)])
    const relationshipsPromise = listRelationshipsForWorkspace(workspace.id)
    const sessionsPromise = Promise.resolve(supabaseAdmin.from("relationship_onboarding_sessions")
        .select("id, relationship_id, status, session_token, is_test, created_by, created_at, updated_at, completed_at")
        .eq("workspace_id", workspace.id)
        .in("status", ["active", "completed"])
        .order("updated_at", { ascending: false }))
        .then((result) => (result.data ?? []) as OnboardingSession[])

    return <main className="min-h-screen bg-neutral-950 px-4 pb-7 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
        <div className="mx-auto max-w-7xl">
            <PanelTabHeader title="Onboarding" description="Relationship onboarding work, submitted information, and assigned delivery setup." />
            <Suspense fallback={<OnboardingPanelFallback />}>
                <OnboardingPanel
                    workspaceId={workspace.id}
                    workspaceSlug={workspace.slug}
                    customDomain={workspace.custom_onboarding_domain}
                    customDomainVerified={workspace.custom_onboarding_domain_status === "verified"}
                    selectedState={selectedState}
                    staffMode={access.role === "staff"}
                    allowedServiceIds={access.allowedServiceIds}
                    relationshipsPromise={relationshipsPromise}
                    sessionsPromise={sessionsPromise}
                    scopesPromise={scopesPromise}
                />
            </Suspense>
        </div>
    </main>
}
