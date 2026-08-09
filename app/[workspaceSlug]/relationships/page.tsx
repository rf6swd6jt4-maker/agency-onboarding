import Link from "next/link"
import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { ListActionMenu } from "@/components/list/ListActionMenu"
import { ListCreatorBadge } from "@/components/list/ListCreatorBadge"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { RelationshipStage, RoundPill, SquarePill, Status } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { SERVICES } from "@/lib/onboarding/services"
import { createUploadSignedUrls } from "@/lib/onboarding/uploads"
import {
    RELATIONSHIP_PHASES,
    countOpenWorkItemsByRelationship,
    relationshipLocationLabel,
    listRelationshipsForWorkspace,
    relationshipHubHref,
    workspaceHref,
    type RelationshipPhase,
} from "@/lib/relationships"
import { requireWorkspace } from "@/lib/workspaces"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
    searchParams: Promise<{ phase?: string }>
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

export default async function RelationshipsPage({ params, searchParams }: PageProps) {
    const { workspaceSlug } = await params
    const { phase: requestedPhase } = await searchParams
    const { workspace, user } = await requireWorkspace(workspaceSlug)
    const [relationships, openWorkCounts] = await Promise.all([
        listRelationshipsForWorkspace(workspace.id),
        countOpenWorkItemsByRelationship(workspace.id),
    ])
    const activeRelationships = relationships.filter((relationship) => relationship.status !== "archived")
    const clientIds = activeRelationships.map((relationship) => relationship.client_id).filter((id): id is string => Boolean(id))
    const clientsResult = clientIds.length
        ? await supabaseAdmin.from("clients").select("id, created_by, is_test").in("id", clientIds)
        : { data: [] as Array<{ id: string; created_by: string | null; is_test: boolean | null }> }
    const clientCreatorById = new Map((clientsResult.data ?? []).map((client) => [client.id, client.created_by]))
    const testClientIds = new Set((clientsResult.data ?? []).filter((client) => client.is_test).map((client) => client.id))
    const channelsResult = clientIds.length
        ? await supabaseAdmin
            .from("client_communication_channels")
            .select("client_id, external_address")
            .in("client_id", clientIds)
            .eq("provider", "meta_whatsapp")
            .eq("is_active", true)
        : { data: [] as Array<{ client_id: string; external_address: string }> }
    const whatsappByClientId = new Map((channelsResult.data ?? []).map((channel) => [channel.client_id, displayPhone(channel.external_address)]))
    const creatorIds = [...new Set(activeRelationships.map((relationship) => (
        metadataUserId(relationship.source_metadata) ?? (relationship.client_id ? clientCreatorById.get(relationship.client_id) : null)
    )).filter((id): id is string => Boolean(id)))]
    const creatorsResult = creatorIds.length
        ? await supabaseAdmin.from("user_profiles").select("user_id, username, avatar_path").in("user_id", creatorIds)
        : { data: [] as Array<{ user_id: string; username: string; avatar_path: string | null }> }
    const creatorById = new Map((creatorsResult.data ?? []).map((creator) => [creator.user_id, creator]))
    const creatorAvatarUrls = await createUploadSignedUrls((creatorsResult.data ?? []).map((creator) => creator.avatar_path).filter((path): path is string => Boolean(path)))
    const relationshipIds = activeRelationships.filter((relationship) => !relationship.fallback).map((relationship) => relationship.id)
    const servicesResult = relationshipIds.length
        ? await supabaseAdmin
            .from("relationship_services")
            .select("relationship_id, service_key")
            .in("relationship_id", relationshipIds)
            .order("created_at", { ascending: true })
        : { data: [] as Array<{ relationship_id: string; service_key: string }> }
    const servicesByRelationshipId = new Map<string, string[]>()
    for (const service of servicesResult.data ?? []) {
        servicesByRelationshipId.set(service.relationship_id, [...(servicesByRelationshipId.get(service.relationship_id) ?? []), service.service_key])
    }
    const phaseCounts = new Map<RelationshipPhase, number>()
    for (const relationship of activeRelationships) {
        phaseCounts.set(relationship.lifecycle_phase, (phaseCounts.get(relationship.lifecycle_phase) ?? 0) + 1)
    }
    const selectedPhase = RELATIONSHIP_PHASES.some((phase) => phase.key === requestedPhase)
        ? requestedPhase as RelationshipPhase
        : null
    const visibleRelationships = selectedPhase
        ? activeRelationships.filter((relationship) => relationship.lifecycle_phase === selectedPhase)
        : activeRelationships

    return (
        <main className="min-h-screen bg-neutral-950 px-4 pb-7 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-7xl pt-5">
                <WorkspaceBanner bannerPath={workspace.banner_path} logoPath={workspace.logo_path} name={workspace.name} height={workspace.banner_height} position={workspace.banner_position} />
                <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight">
                            Relationships
                        </h1>
                        <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">
                            The canonical CRM surface for leads, sales, onboarding, fulfilment, assets, and future project work.
                        </p>
                    </div>
                    <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
                        <Link href={workspaceHref(workspace.slug, "relationships?create=relationship")} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-4 py-2 text-center text-sm font-medium leading-none text-black sm:min-h-10 sm:px-3">
                            Start new relationship
                        </Link>
                    </div>
                </header>

                <section className="mt-5 border-y border-neutral-800/80 py-1">
                    <nav aria-label="Filter relationships by lifecycle stage" className="flex gap-1 overflow-x-auto overscroll-x-contain px-1 pb-1">
                        <Link
                            href={workspaceHref(workspace.slug, "relationships")}
                            aria-current={!selectedPhase ? "page" : undefined}
                            className={`shrink-0 border-b px-2 py-2 text-sm transition-colors ${!selectedPhase ? "border-white text-white" : "border-transparent text-neutral-500 hover:border-neutral-700 hover:text-neutral-200"}`}
                        >
                            All <span className="ml-1 tabular-nums text-neutral-500">{activeRelationships.length}</span>
                        </Link>
                        {RELATIONSHIP_PHASES.map((phase) => {
                            const selected = selectedPhase === phase.key
                            return <Link
                                key={phase.key}
                                href={workspaceHref(workspace.slug, `relationships?phase=${phase.key}`)}
                                aria-current={selected ? "page" : undefined}
                                className={`shrink-0 border-b px-2 py-2 text-sm transition-colors ${selected ? "border-white text-white" : "border-transparent text-neutral-500 hover:border-neutral-700 hover:text-neutral-200"}`}
                            >
                                {phase.label} <span className="ml-1 tabular-nums text-neutral-500">{phaseCounts.get(phase.key) ?? 0}</span>
                            </Link>
                        })}
                    </nav>
                </section>

                <List ariaLabel="Relationships">
                    {visibleRelationships.length ? (
                        visibleRelationships.map((relationship) => {
                            const location = relationshipLocationLabel(relationship)
                            const openWorkCount = openWorkCounts.get(relationship.id) ?? 0
                            const relationshipHref = relationshipHubHref(workspace.slug, relationship.id)
                            const storedPhone = relationship.primary_phone
                            const whatsappPhone = relationship.client_id ? whatsappByClientId.get(relationship.client_id) ?? null : null
                            const smsPhone = storedPhone?.toLowerCase().startsWith("whatsapp:") ? null : displayPhone(storedPhone)
                            const fallbackWhatsappPhone = storedPhone?.toLowerCase().startsWith("whatsapp:") ? displayPhone(storedPhone) : null
                            const effectiveWhatsappPhone = whatsappPhone ?? fallbackWhatsappPhone
                            const creatorId = metadataUserId(relationship.source_metadata) ?? (relationship.client_id ? clientCreatorById.get(relationship.client_id) : null)
                            const creator = creatorId ? creatorById.get(creatorId) : null
                            const relationshipTitle = relationship.business_name
                                ? `${relationship.primary_person_name} – ${relationship.business_name}`
                                : relationship.primary_person_name
                            const isTest = Boolean(relationship.source_metadata.is_test) || Boolean(relationship.client_id && testClientIds.has(relationship.client_id))
                            const serviceKeys = servicesByRelationshipId.get(relationship.id) ?? []
                            const workStatus = relationshipWorkStatus(openWorkCount)
                            const relationshipActions = [
                                { label: "Open relationship", href: relationshipHref },
                                smsPhone ? { label: "Copy phone", copyText: smsPhone } : {},
                                effectiveWhatsappPhone ? { label: "Copy WhatsApp", copyText: effectiveWhatsappPhone } : {},
                                relationship.primary_email ? { label: "Copy email", copyText: relationship.primary_email } : {},
                            ]
                            return (
                                <ListItem key={relationship.id}>
                                    <ListPrimaryRow>
                                        <ListTitle href={relationshipHref} className="flex-1">{relationshipTitle}</ListTitle>
                                        {isTest ? <SquarePill tone="yellow" className="shrink-0">Test</SquarePill> : null}
                                        <RelationshipStage phase={relationship.lifecycle_phase} className="shrink-0" />
                                        <span className="ml-auto shrink-0">{workStatus}</span>
                                    </ListPrimaryRow>
                                    <ListSecondaryRow>
                                        {relationship.primary_contact_role ? <span className="hidden shrink-0 text-neutral-400 lg:inline">{relationship.primary_contact_role}</span> : null}
                                        {smsPhone ? <span className="min-w-0 truncate text-neutral-200">SMS: {smsPhone}</span> : null}
                                        {effectiveWhatsappPhone ? <span className={`min-w-0 truncate text-neutral-400 ${smsPhone ? "hidden sm:inline" : ""}`}>WA: {effectiveWhatsappPhone}</span> : null}
                                        {!smsPhone && !effectiveWhatsappPhone ? <span className="min-w-0 truncate text-neutral-500">No phone</span> : null}
                                        <span className="hidden min-w-0 truncate text-neutral-400 md:inline">{relationship.primary_email ?? "No email saved"}</span>
                                        <span className="hidden min-w-0 truncate capitalize text-neutral-500 lg:inline">{location ?? "Location unset"}</span>
                                        {serviceKeys.map((serviceKey) => <RoundPill key={serviceKey} tone="emerald" className="hidden xl:inline-flex">{SERVICES[serviceKey]?.title ?? serviceKey}</RoundPill>)}
                                        <ListTrailing>
                                            <span className="hidden font-mono text-neutral-500 sm:inline">{shortId(relationship.id)}</span>
                                            <span className="whitespace-nowrap text-neutral-500">{formatRelativeTime(relationship.updated_at)}</span>
                                            <ListCreatorBadge src={creator?.avatar_path ? creatorAvatarUrls.get(creator.avatar_path) : null} username={creator?.username ?? null} label="Added by" date={new Date(relationship.created_at).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })} />
                                            <ListActionMenu actions={relationshipActions} />
                                        </ListTrailing>
                                    </ListSecondaryRow>
                                </ListItem>
                            )
                        })
                    ) : (
                        <div className="p-6">
                            <p className="text-lg font-semibold">{selectedPhase ? `No ${RELATIONSHIP_PHASES.find((phase) => phase.key === selectedPhase)?.label.toLowerCase()} relationships.` : "No relationships yet."}</p>
                            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">
                                {selectedPhase ? <>Choose another lifecycle stage or <Link href={workspaceHref(workspace.slug, "relationships")} className="text-neutral-200 underline decoration-neutral-600 underline-offset-4 hover:text-white">show all relationships</Link>.</> : "Promote a qualified lead or start a relationship manually. From here it can move into nurturing, sales, onboarding, fulfilment, and retention without changing record type."}
                            </p>
                        </div>
                    )}
                </List>
            </div>
        </main>
    )
}
