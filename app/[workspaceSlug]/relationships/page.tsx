import Link from "next/link"
import { Suspense } from "react"
import { ListActionMenu, type ListAction } from "@/components/list/ListActionMenu"
import { ListCreatorBadge } from "@/components/list/ListCreatorBadge"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { MobileListActionSurface } from "@/components/list/MobileCardActionSurface"
import { MobileAssignedServices } from "@/components/list/MobileAssignedServices"
import { FilterRail, FilterRailCount, FilterRailLink } from "@/components/panel/FilterRail"
import { InstantFilterResults } from "@/components/panel/InstantFilterResults"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { RelationshipStage, RoundPill, SquarePill, Status } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { relationshipServiceDisplayName, type OnboardingServiceRevisionDisplay, type StoredRelationshipService } from "@/lib/onboarding/service-display"
import { loadOnboardingServiceRevisionDisplays } from "@/lib/onboarding/service-revisions"
import { profileAvatarUrl } from "@/lib/profile-avatar"
import {
    RELATIONSHIP_PHASES,
    countOpenWorkItemsByRelationship,
    relationshipLocationLabel,
    listRelationshipsForWorkspace,
    relationshipHubHref,
    workspaceHref,
    type RelationshipPhase,
    type RelationshipRecord,
} from "@/lib/relationships"
import { requireWorkspacePanel } from "@/lib/workspace-access"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
    searchParams: Promise<{ phase?: string }>
}

type RelationshipCreator = {
    user_id: string
    username: string
    avatar_path: string | null
}

type RelationshipEnrichment = {
    clientCreatorById: Map<string, string | null>
    testClientIds: Set<string>
    whatsappByClientId: Map<string, string | null>
    creatorById: Map<string, RelationshipCreator>
    servicesByRelationshipId: Map<string, Array<StoredRelationshipService & { relationship_id: string }>>
    serviceRevisions: Map<string, OnboardingServiceRevisionDisplay>
}

function metadataUserId(metadata: Record<string, unknown>) {
    const value = metadata.created_by ?? metadata.promoted_by
    return typeof value === "string" ? value : null
}

function displayPhone(value: string | null | undefined) {
    return value?.replace(/^(?:sms|whatsapp):/i, "") ?? null
}

function relationshipWorkStatus(openWorkCount: number, urgent = false) {
    if (urgent) return <Status label="Urgent" tone="red" />
    if (openWorkCount > 0) return <Status label="Open work" tone="yellow" />
    return <Status label="Up to date" tone="green" />
}

function relationshipPhones(relationship: RelationshipRecord, channelWhatsapp?: string | null) {
    const storedPhone = relationship.primary_phone
    const smsPhone = storedPhone?.toLowerCase().startsWith("whatsapp:") ? null : displayPhone(storedPhone)
    const fallbackWhatsappPhone = storedPhone?.toLowerCase().startsWith("whatsapp:") ? displayPhone(storedPhone) : null
    const effectiveWhatsappPhone = channelWhatsapp ?? fallbackWhatsappPhone
    return { smsPhone, effectiveWhatsappPhone }
}

function relationshipActions(relationship: RelationshipRecord, relationshipHref: string, channelWhatsapp?: string | null): Array<Partial<ListAction>> {
    const { smsPhone, effectiveWhatsappPhone } = relationshipPhones(relationship, channelWhatsapp)
    return [
        { label: "Open relationship", href: relationshipHref },
        smsPhone ? { label: "Copy phone", copyText: smsPhone } : {},
        effectiveWhatsappPhone ? { label: "Copy WhatsApp", copyText: effectiveWhatsappPhone } : {},
        relationship.primary_email ? { label: "Copy email", copyText: relationship.primary_email } : {},
    ]
}

async function loadRelationshipEnrichment(workspaceId: string, relationships: RelationshipRecord[]): Promise<RelationshipEnrichment> {
    const clientIds = [...new Set(relationships.map((relationship) => relationship.client_id).filter((id): id is string => Boolean(id)))]
    const relationshipIds = relationships.filter((relationship) => !relationship.fallback).map((relationship) => relationship.id)
    const [clientsResult, channelsResult, servicesResult] = await Promise.all([
        clientIds.length
            ? supabaseAdmin.from("clients").select("id, created_by, is_test").in("id", clientIds)
            : Promise.resolve({ data: [] as Array<{ id: string; created_by: string | null; is_test: boolean | null }> }),
        clientIds.length
            ? supabaseAdmin.from("client_communication_channels").select("client_id, external_address").in("client_id", clientIds).eq("provider", "meta_whatsapp").eq("is_active", true)
            : Promise.resolve({ data: [] as Array<{ client_id: string; external_address: string }> }),
        relationshipIds.length
            ? supabaseAdmin.from("relationship_services").select("relationship_id, service_key, service_revision_id").in("relationship_id", relationshipIds).order("created_at", { ascending: true })
            : Promise.resolve({ data: [] as Array<{ relationship_id: string; service_key: string; service_revision_id: string | null }> }),
    ])
    const clientCreatorById = new Map((clientsResult.data ?? []).map((client) => [client.id, client.created_by]))
    const testClientIds = new Set((clientsResult.data ?? []).filter((client) => client.is_test).map((client) => client.id))
    const whatsappByClientId = new Map((channelsResult.data ?? []).map((channel) => [channel.client_id, displayPhone(channel.external_address)]))
    const creatorIds = [...new Set(relationships.map((relationship) => (
        metadataUserId(relationship.source_metadata) ?? (relationship.client_id ? clientCreatorById.get(relationship.client_id) : null)
    )).filter((id): id is string => Boolean(id)))]
    const [creatorsResult, serviceRevisions] = await Promise.all([
        creatorIds.length
            ? supabaseAdmin.from("user_profiles").select("user_id, username, avatar_path").in("user_id", creatorIds)
            : Promise.resolve({ data: [] as RelationshipCreator[] }),
        loadOnboardingServiceRevisionDisplays(workspaceId, (servicesResult.data ?? []).map((service) => service.service_revision_id)),
    ])
    const creatorById = new Map((creatorsResult.data ?? []).map((creator) => [creator.user_id, creator]))
    const servicesByRelationshipId = new Map<string, Array<StoredRelationshipService & { relationship_id: string }>>()
    for (const service of servicesResult.data ?? []) {
        const existing = servicesByRelationshipId.get(service.relationship_id) ?? []
        if (!existing.some((candidate) => candidate.service_key === service.service_key)) {
            servicesByRelationshipId.set(service.relationship_id, [...existing, service])
        }
    }
    return { clientCreatorById, testClientIds, whatsappByClientId, creatorById, servicesByRelationshipId, serviceRevisions }
}

async function RelationshipWorkStatus({ relationshipId, openWorkCountsPromise }: { relationshipId: string; openWorkCountsPromise: ReturnType<typeof countOpenWorkItemsByRelationship> }) {
    const openWorkCounts = await openWorkCountsPromise
    return relationshipWorkStatus(openWorkCounts.get(relationshipId) ?? 0)
}

async function RelationshipClientTestBadge({ clientId, enrichmentPromise }: { clientId: string; enrichmentPromise: Promise<RelationshipEnrichment> }) {
    const enrichment = await enrichmentPromise
    return enrichment.testClientIds.has(clientId) ? <SquarePill tone="yellow" className="shrink-0">Test</SquarePill> : null
}

function RelationshipSecondaryFallback() {
    return <ListSecondaryRow className="min-h-[49px]">
        <span aria-hidden="true" className="h-5 w-24 animate-pulse rounded-full bg-neutral-800" />
        <span aria-hidden="true" className="hidden h-4 w-28 animate-pulse rounded bg-neutral-900 sm:inline" />
        <span aria-hidden="true" className="hidden h-4 w-40 animate-pulse rounded bg-neutral-900 md:inline" />
        <span aria-hidden="true" className="ml-auto h-4 w-24 animate-pulse rounded bg-neutral-900" />
    </ListSecondaryRow>
}

async function RelationshipSecondary({ relationship, relationshipHref, enrichmentPromise }: { relationship: RelationshipRecord; relationshipHref: string; enrichmentPromise: Promise<RelationshipEnrichment> }) {
    const enrichment = await enrichmentPromise
    const channelWhatsapp = relationship.client_id ? enrichment.whatsappByClientId.get(relationship.client_id) ?? null : null
    const { smsPhone, effectiveWhatsappPhone } = relationshipPhones(relationship, channelWhatsapp)
    const creatorId = metadataUserId(relationship.source_metadata) ?? (relationship.client_id ? enrichment.clientCreatorById.get(relationship.client_id) : null)
    const creator = creatorId ? enrichment.creatorById.get(creatorId) : null
    const relationshipServices = enrichment.servicesByRelationshipId.get(relationship.id) ?? []
    const serviceLabels = relationshipServices.map((service) => relationshipServiceDisplayName(service, enrichment.serviceRevisions))
    const creatorAvatarSrc = creator?.avatar_path && creator.username ? profileAvatarUrl(creator.username, creator.avatar_path) : null
    const location = relationshipLocationLabel(relationship)
    const actions = relationshipActions(relationship, relationshipHref, channelWhatsapp)

    return <ListSecondaryRow>
        <MobileAssignedServices labels={serviceLabels} />
        {relationship.primary_contact_role ? <span className="hidden shrink-0 text-neutral-400 lg:inline">{relationship.primary_contact_role}</span> : null}
        {smsPhone ? <span className="hidden min-w-0 truncate text-neutral-200 sm:inline">SMS: {smsPhone}</span> : null}
        {effectiveWhatsappPhone ? <span className="hidden min-w-0 truncate text-neutral-400 sm:inline">WA: {effectiveWhatsappPhone}</span> : null}
        {!smsPhone && !effectiveWhatsappPhone ? <span className="hidden min-w-0 truncate text-neutral-500 sm:inline">No phone</span> : null}
        <span className="hidden min-w-0 truncate text-neutral-400 md:inline">{relationship.primary_email ?? "No email saved"}</span>
        <span className="hidden min-w-0 truncate capitalize text-neutral-500 lg:inline">{location ?? "Location unset"}</span>
        <div className="hidden min-w-0 items-center gap-3 overflow-hidden xl:flex">
            {relationshipServices.map((service) => <RoundPill key={`${service.service_key}:${service.service_revision_id ?? "legacy"}`} tone="emerald" className="shrink-0">{relationshipServiceDisplayName(service, enrichment.serviceRevisions)}</RoundPill>)}
        </div>
        {relationshipServices.length === 0 ? <span className="hidden text-neutral-500 sm:inline">No assigned services</span> : null}
        <ListTrailing>
            <span className="font-mono text-neutral-500">{shortId(relationship.id)}</span>
            <span className="whitespace-nowrap text-neutral-500">{formatRelativeTime(relationship.updated_at)}</span>
            <ListCreatorBadge src={creatorAvatarSrc} username={creator?.username ?? null} label="Added by" date={new Date(relationship.created_at).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })} />
            <ListActionMenu actions={actions} className="hidden sm:block" />
        </ListTrailing>
    </ListSecondaryRow>
}

function RelationshipRow({ relationship, openWorkCountsPromise, enrichmentPromise, workspaceSlug }: { relationship: RelationshipRecord; openWorkCountsPromise: ReturnType<typeof countOpenWorkItemsByRelationship>; enrichmentPromise: Promise<RelationshipEnrichment>; workspaceSlug: string }) {
    const relationshipHref = relationshipHubHref(workspaceSlug, relationship.id)
    const relationshipTitle = relationship.business_name
        ? `${relationship.primary_person_name} – ${relationship.business_name}`
        : relationship.primary_person_name
    const isKnownTest = Boolean(relationship.source_metadata.is_test)

    return <ListItem detailPreview={{
        category: "Relationship",
        reference: shortId(relationship.id),
        title: relationship.primary_person_name,
        subtitle: relationship.business_name ?? "No company saved",
        updated: formatRelativeTime(relationship.updated_at),
    }}>
        <MobileListActionSurface actions={relationshipActions(relationship, relationshipHref)} label={`Open actions for ${relationshipTitle}`}>
            <ListPrimaryRow>
                <ListTitle href={relationshipHref} className="flex-1">{relationshipTitle}</ListTitle>
                {isKnownTest ? <SquarePill tone="yellow" className="shrink-0">Test</SquarePill> : relationship.client_id ? <Suspense fallback={null}><RelationshipClientTestBadge clientId={relationship.client_id} enrichmentPromise={enrichmentPromise} /></Suspense> : null}
                <RelationshipStage phase={relationship.lifecycle_phase} className="shrink-0" />
                <span className="ml-auto shrink-0"><Suspense fallback={<Status label="Loading work status" tone="grey" compact className="animate-pulse" />}><RelationshipWorkStatus relationshipId={relationship.id} openWorkCountsPromise={openWorkCountsPromise} /></Suspense></span>
            </ListPrimaryRow>
            <Suspense fallback={<RelationshipSecondaryFallback />}>
                <RelationshipSecondary relationship={relationship} relationshipHref={relationshipHref} enrichmentPromise={enrichmentPromise} />
            </Suspense>
        </MobileListActionSurface>
    </ListItem>
}

async function RelationshipsPanel({ workspaceId, workspaceSlug, selectedPhase, relationshipsPromise, openWorkCountsPromise }: { workspaceId: string; workspaceSlug: string; selectedPhase: RelationshipPhase | null; relationshipsPromise: ReturnType<typeof listRelationshipsForWorkspace>; openWorkCountsPromise: ReturnType<typeof countOpenWorkItemsByRelationship> }) {
    const relationships = await relationshipsPromise
    const activeRelationships = relationships.filter((relationship) => relationship.status !== "archived")
    const enrichmentPromise = loadRelationshipEnrichment(workspaceId, activeRelationships)
    const phaseCounts = new Map<RelationshipPhase, number>()
    for (const relationship of activeRelationships) {
        phaseCounts.set(relationship.lifecycle_phase, (phaseCounts.get(relationship.lifecycle_phase) ?? 0) + 1)
    }
    return <>
        <FilterRail ariaLabel="Filter relationships by lifecycle stage">
            <FilterRailLink href={workspaceHref(workspaceSlug, "relationships")} selected={!selectedPhase} instant={{ param: "phase", value: null }}>
                All <FilterRailCount>{activeRelationships.length}</FilterRailCount>
            </FilterRailLink>
            {RELATIONSHIP_PHASES.map((phase) => <FilterRailLink key={phase.key} href={workspaceHref(workspaceSlug, `relationships?phase=${phase.key}`)} selected={selectedPhase === phase.key} instant={{ param: "phase", value: phase.key }}>
                {phase.label} <FilterRailCount>{phaseCounts.get(phase.key) ?? 0}</FilterRailCount>
            </FilterRailLink>)}
        </FilterRail>

        <List ariaLabel="Relationships">
            <InstantFilterResults
                filters={[{ param: "phase" }]}
                items={activeRelationships.map((relationship) => ({
                    id: relationship.id,
                    values: { phase: relationship.lifecycle_phase },
                    content: <RelationshipRow
                        relationship={relationship}
                        workspaceSlug={workspaceSlug}
                        openWorkCountsPromise={openWorkCountsPromise}
                        enrichmentPromise={enrichmentPromise}
                    />,
                }))}
                empty={<div className="p-6">
                    <p className="text-lg font-semibold">No relationships match this lifecycle stage.</p>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">Choose another lifecycle stage above to broaden the list.</p>
                </div>}
            />
        </List>
    </>
}

function RelationshipsPanelFallback() {
    return <div aria-label="Loading relationships" aria-busy="true">
        <FilterRail ariaLabel="Loading relationship filters">
            {[72, 84, 112, 76, 98, 88].map((width, index) => <span key={index} className="shrink-0 px-2 py-2"><span className="block h-4 animate-pulse rounded bg-neutral-800" style={{ width }} /></span>)}
        </FilterRail>
        <List ariaLabel="Loading relationships">
            {Array.from({ length: 5 }, (_, index) => <ListItem key={index}>
                <ListPrimaryRow>
                    <span className="h-5 w-48 animate-pulse rounded bg-neutral-800" />
                    <span className="h-6 w-24 animate-pulse bg-neutral-800" />
                    <span className="ml-auto h-4 w-20 animate-pulse rounded bg-neutral-800" />
                </ListPrimaryRow>
                <RelationshipSecondaryFallback />
            </ListItem>)}
        </List>
    </div>
}

export default async function RelationshipsPage({ params, searchParams }: PageProps) {
    const { workspaceSlug } = await params
    const { phase: requestedPhase } = await searchParams
    const { workspace, user } = await requireWorkspacePanel(workspaceSlug, "relationships")
    const selectedPhase = RELATIONSHIP_PHASES.some((phase) => phase.key === requestedPhase)
        ? requestedPhase as RelationshipPhase
        : null
    const relationshipsPromise = listRelationshipsForWorkspace(workspace.id)
    const openWorkCountsPromise = countOpenWorkItemsByRelationship(workspace.id)

    return <main className="min-h-screen bg-neutral-950 px-4 pb-7 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
        <div className="mx-auto max-w-7xl">
            <PanelTabHeader
                title="Relationships"
                description="People and businesses moving through lead, sales, onboarding, fulfilment, and retention."
                actions={<Link href={workspaceHref(workspace.slug, "relationships?create=relationship")} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-4 py-2 text-center text-sm font-medium leading-none text-black sm:min-h-10 sm:px-3">Start new relationship</Link>}
            />
            <Suspense fallback={<RelationshipsPanelFallback />}>
                <RelationshipsPanel workspaceId={workspace.id} workspaceSlug={workspace.slug} selectedPhase={selectedPhase} relationshipsPromise={relationshipsPromise} openWorkCountsPromise={openWorkCountsPromise} />
            </Suspense>
        </div>
    </main>
}
