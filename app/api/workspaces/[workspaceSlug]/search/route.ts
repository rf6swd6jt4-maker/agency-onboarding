import type { NextRequest } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import {
    communicationsHref,
    assetHref,
    listRelationshipsForWorkspace,
    onboardingDetailHref,
    relationshipHubHref,
    relationshipNativeLocation,
    relationshipSearchHaystack,
    workItemHref,
    workspaceHref,
    type RelationshipRecord,
} from "@/lib/relationships"
import { shortId } from "@/lib/ui/relative-time"
import { okrDisplayTitle, type WorkspaceOkrType } from "@/lib/admin/okr-title"
import { canAccessPrivateWorkspacePanels, canAccessWorkspacePanel, WORKSPACE_PANELS, workspacePanelHref } from "@/lib/workspace-panels"
import { normalizeWorkspaceRole, type WorkspaceRole } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type SearchResult = {
    id: string
    type: string
    label: string
    description: string
    href: string
    hubHref?: string
    path?: string
    recordId?: string
}

function includesQuery(values: Array<unknown>, query: string) {
    return values
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .join(" ")
        .toLowerCase()
        .includes(query)
}

function jsonRecord(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function result(id: string, type: string, label: string, description: string, href: string, options: Pick<SearchResult, "hubHref" | "path" | "recordId"> = {}): SearchResult {
    return { id, type, label, description, href, ...options }
}

function staticNavigationResults(workspace: { name: string; slug: string }, query: string, role: WorkspaceRole): SearchResult[] {
    const settingsPath = `${workspace.name} > Settings`
    const libraryPath = `${workspace.name} > Library`
    const canAccessPrivatePanels = canAccessPrivateWorkspacePanels(role)
    const panelEntries = WORKSPACE_PANELS
        .filter((panel) => canAccessWorkspacePanel(panel, role))
        .map((panel) => ({
            id: `panel-${panel.key}`,
            type: "Panel",
            label: panel.label,
            description: panel.description,
            href: workspacePanelHref(workspace.slug, panel),
            path: `${workspace.name} > ${panel.label}`,
            keywords: [...panel.keywords],
        }))
    const entries = [
        ...panelEntries,
        { id: "tab-work-items", type: "Tab", label: "Work Items", description: "Workspace-native task IDs and work item list", href: workspaceHref(workspace.slug, "work-items"), path: `${libraryPath} > Work Items`, keywords: ["tasks", "work item ids", "work ids"] },
        { id: "tab-assets", type: "Tab", label: "Assets", description: "Workspace asset IDs and file gallery", href: workspaceHref(workspace.slug, "assets"), path: `${libraryPath} > Assets`, keywords: ["files", "uploads", "asset ids", "gallery"] },
        { id: "action-new-relationship", type: "Action", label: "Start New Relationship", description: "Create a relationship manually at any lifecycle stage", href: workspaceHref(workspace.slug, "relationships?create=relationship"), path: `${workspace.name} > Relationships > New`, keywords: ["manual relationship", "new relationship", "add relationship", "manual client", "new client", "add client"] },
        ...(canAccessPrivatePanels ? [
            { id: "action-new-poll", type: "Action", label: "New Poll", description: "Create and preflight a new lead-generation poll", href: workspaceHref(workspace.slug, "leadgen/new"), path: `${workspace.name} > Lead Gen > New Poll`, keywords: ["create poll", "start poll", "run poll", "poll preflight", "leadgen new"] },
            { id: "tab-leads", type: "Tab", label: "Leads", description: "Qualified and discovered lead list", href: workspaceHref(workspace.slug, "leadgen"), path: `${workspace.name} > Lead Gen > Leads`, keywords: ["leadgen companies", "lead list"] },
            { id: "tab-polls", type: "Tab", label: "Polls", description: "Lead generation poll history", href: workspaceHref(workspace.slug, "leadgen/polls"), path: `${workspace.name} > Lead Gen > Polls`, keywords: ["runs", "automation history"] },
            { id: "settings-workspace", type: "Settings", label: "Workspace", description: "Edit the workspace name", href: workspaceHref(workspace.slug, "settings#workspace"), path: `${settingsPath} > Workspace`, keywords: ["name", "identity"] },
            { id: "settings-services", type: "Settings", label: "Services", description: "Service catalogue, prices, assignees, and onboarding module assignments", href: workspaceHref(workspace.slug, "settings#services"), path: `${settingsPath} > Services`, keywords: ["catalogue", "pricing", "service modules"] },
            { id: "settings-onboarding", type: "Settings", label: "Onboarding Settings", description: "Mandatory modules, bookends, client help, and custom domain", href: workspaceHref(workspace.slug, "settings#onboarding"), path: `${settingsPath} > Onboarding`, keywords: ["mandatory modules", "welcome", "completion", "builder"] },
            { id: "settings-agency-branding", type: "Settings", label: "Agency Branding", description: "Client-facing onboarding and portal colours", href: workspaceHref(workspace.slug, "settings#agency-branding"), path: `${settingsPath} > Agency Branding`, keywords: ["colours", "colors", "theme", "client portal branding"] },
            { id: "settings-onboarding-domain", type: "Settings", label: "Onboarding Domain", description: "Verified client onboarding hostname", href: workspaceHref(workspace.slug, "settings#onboarding-domain"), path: `${settingsPath} > Onboarding Domain`, keywords: ["custom domain", "hostname", "portal"] },
            { id: "settings-connections", type: "Settings", label: "Connections", description: "Stripe and WhatsApp credentials", href: workspaceHref(workspace.slug, "settings#connections"), path: `${settingsPath} > Connections`, keywords: ["stripe", "whatsapp", "meta"] },
            { id: "settings-users", type: "Settings", label: "Users", description: "Access and invitations", href: workspaceHref(workspace.slug, "settings#users"), path: `${settingsPath} > Users`, keywords: ["team", "staff", "invite"] },
            { id: "settings-officers", type: "Settings", label: "Officers", description: "Global and category responsibility for maintenance failures", href: workspaceHref(workspace.slug, "settings#officers"), path: `${settingsPath} > Officers`, keywords: ["responsible officers", "global officer", "maintenance routing", "failure assignee"] },
            { id: "settings-leadgen", type: "Settings", label: "Lead Gen", description: "Poll automation, ICP targeting, sources, mappings, and runtime controls", href: workspaceHref(workspace.slug, "settings#leadgen"), path: `${settingsPath} > Lead Gen`, keywords: ["lead gen settings", "automation", "targeting", "sources"] },
            { id: "settings-leadgen-automation", type: "Settings", label: "Poll Automation", description: "Poll cadence, candidate volume, and owner-evidence defaults", href: workspaceHref(workspace.slug, "settings#leadgen-automation"), path: `${settingsPath} > Lead Gen > Poll Automation`, keywords: ["automatic polls", "cadence", "lead gen automation"] },
            { id: "settings-leadgen-targeting", type: "Settings", label: "Target Industries and Locations", description: "ICP industries and locations", href: workspaceHref(workspace.slug, "settings#leadgen-targeting"), path: `${settingsPath} > Lead Gen > Targeting`, keywords: ["industries", "locations", "icp", "lead gen targeting"] },
            { id: "settings-leadgen-sources", type: "Settings", label: "Sources", description: "Source readiness, mappings, and controls", href: workspaceHref(workspace.slug, "settings#leadgen-sources"), path: `${settingsPath} > Lead Gen > Sources`, keywords: ["lead gen sources", "mappings", "source controls"] },
            { id: "settings-leadgen-sources-seed", type: "Settings", label: "Seed Sources", description: "Candidate creation sources required before staged validation and owner discovery can run", href: workspaceHref(workspace.slug, "settings#leadgen-sources-seed"), path: `${settingsPath} > Lead Gen > Sources > Seed Sources`, keywords: ["lead gen source category", "source categories", "seed sources", "candidate sources", "overture", "osm", "web crawler"] },
            { id: "settings-leadgen-sources-business-validation", type: "Settings", label: "Business Validation Sources", description: "Sources that confirm a seeded business is real enough to enter the owner pipeline", href: workspaceHref(workspace.slug, "settings#leadgen-sources-business-validation"), path: `${settingsPath} > Lead Gen > Sources > Business Validation Sources`, keywords: ["lead gen source category", "source categories", "business validation", "validation sources", "business validation sources"] },
            { id: "settings-leadgen-sources-owner-identity", type: "Settings", label: "Owner Identity Discovery", description: "Sources that can find credible owner, principal, license holder, or authorised official names", href: workspaceHref(workspace.slug, "settings#leadgen-sources-owner-identity"), path: `${settingsPath} > Lead Gen > Sources > Owner Identity Discovery`, keywords: ["lead gen source category", "source categories", "owner identity", "owner identity discovery", "owner discovery", "owner name sources"] },
            { id: "settings-leadgen-sources-owner-phone", type: "Settings", label: "Owner Phone Sources", description: "Sources that can attach a phone number to the discovered owner or principal", href: workspaceHref(workspace.slug, "settings#leadgen-sources-owner-phone"), path: `${settingsPath} > Lead Gen > Sources > Owner Phone Sources`, keywords: ["lead gen source category", "source categories", "owner phone", "owner phone sources", "phone discovery"] },
            { id: "settings-leadgen-sources-phone-validation", type: "Settings", label: "Phone Validation Sources", description: "Sources that check owner-phone format and future reachability signals", href: workspaceHref(workspace.slug, "settings#leadgen-sources-phone-validation"), path: `${settingsPath} > Lead Gen > Sources > Phone Validation Sources`, keywords: ["lead gen source category", "source categories", "phone validation", "phone validation sources", "validate phones"] },
        ] : []),
    ]

    return entries
        .filter((entry) => includesQuery([entry.label, entry.description, entry.path, ...entry.keywords], query))
        .map((entry) => ({
            id: entry.id,
            type: entry.type,
            label: entry.label,
            description: entry.description,
            href: entry.href,
            path: entry.path,
        }))
        .slice(0, 6)
}

async function requireSearchWorkspace(workspaceSlug: string) {
    const supabase = await createSupabaseServerClient()
    const { data: userData } = await supabase.auth.getUser()
    const user = userData.user
    if (!user) return null

    const { data: workspace } = await supabaseAdmin
        .from("workspaces")
        .select("id, slug, name, status")
        .eq("slug", workspaceSlug)
        .eq("status", "active")
        .maybeSingle()

    if (!workspace) return null

    const { data: membership } = await supabaseAdmin
        .from("workspace_memberships")
        .select("role")
        .eq("workspace_id", workspace.id)
        .eq("user_id", user.id)
        .maybeSingle()

    const role = normalizeWorkspaceRole(membership?.role)
    return membership && role ? {
        workspace: workspace as { id: string; slug: string; name: string; status: string },
        role,
    } : null
}

export async function GET(request: NextRequest, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const access = await requireSearchWorkspace(workspaceSlug)
    if (!access) return Response.json({ results: [] }, { status: 401 })
    const { workspace, role } = access
    const canAccessPrivatePanels = canAccessPrivateWorkspacePanels(role)

    const rawQuery = request.nextUrl.searchParams.get("q") ?? ""
    const query = rawQuery.trim().toLowerCase()
    if (query.length < 2) return Response.json({ results: [] })

    const results: SearchResult[] = []
    results.push(...staticNavigationResults(workspace, query, role))

    const relationships = await listRelationshipsForWorkspace(workspace.id)

    for (const relationship of relationships.filter((item) => relationshipSearchHaystack(item).includes(query) || includesQuery([item.id, item.client_id, item.leadgen_company_id], query)).slice(0, 8)) {
        results.push(result(
            `relationship-${relationship.id}`,
            "Relationship",
            relationship.primary_person_name,
            relationship.business_name ?? relationship.primary_email ?? relationship.primary_phone ?? "Relationship Hub",
            relationshipNativeLocation(workspace.slug, relationship),
            {
                hubHref: relationshipHubHref(workspace.slug, relationship.id),
                path: `${workspace.name} > Relationships`,
                recordId: shortId(relationship.id),
            }
        ))
    }

    const relationshipByClientId = new Map(relationships.map((relationship) => [relationship.client_id, relationship]).filter((entry): entry is [string, RelationshipRecord] => Boolean(entry[0])))

    const workItemSelect = "id, title, description, lifecycle_phase, native_href, native_kind, native_id, area, kind, visibility, maintenance_category"
    const [publicWorkItems, privateWorkItems] = await Promise.all([
        supabaseAdmin.from("work_items").select(workItemSelect).eq("workspace_id", workspace.id).eq("visibility", "workspace").limit(80),
        canAccessPrivatePanels
            ? supabaseAdmin.from("work_items").select(workItemSelect).eq("workspace_id", workspace.id).eq("visibility", "admins_only").limit(80)
            : Promise.resolve({ data: [], error: null }),
    ])
    const workItems = { data: [...(publicWorkItems.data ?? []), ...(privateWorkItems.data ?? [])], error: publicWorkItems.error ?? privateWorkItems.error }

    if (!workItems.error) {
        for (const item of (workItems.data ?? []).filter((item) => includesQuery([item.id, item.native_id, item.title, item.description, item.lifecycle_phase], query)).slice(0, 6)) {
            const isPrivate = item.visibility === "admins_only"
            results.push(result(
                `work-${item.id}`,
                item.kind === "maintenance" ? "Maintenance" : item.kind === "okr_action" ? "OKR action" : "Work item",
                item.title,
                item.description ?? (isPrivate ? "Admin work item" : "Workspace work item"),
                workItemHref(workspace.slug, item.id),
                {
                    hubHref: item.native_href?.startsWith("/") ? item.native_href : undefined,
                    path: isPrivate
                        ? `${workspace.name} > Admin > ${item.kind === "maintenance" ? "Maintenance" : "Work"}`
                        : `${workspace.name} > Library > Work Items`,
                    recordId: shortId(item.id),
                }
            ))
        }
    }

    if (canAccessPrivatePanels) {
        const [{ data: okrs }, { data: keyResults }, { data: adminActivity }, moduleResult, moduleRevisionResult, serviceResult, serviceRevisionResult] = await Promise.all([
            supabaseAdmin.from("workspace_okrs").select("id, objective, objective_type, description, status, period_start, period_end").eq("workspace_id", workspace.id).limit(60),
            supabaseAdmin.from("workspace_okr_key_results").select("id, okr_id, name, description, unit, comparator, baseline_value, target_value").eq("workspace_id", workspace.id).limit(100),
            supabaseAdmin.from("workspace_admin_activity").select("id, category, level, event_key, summary, entity_type, entity_id, source_href, occurred_at").eq("workspace_id", workspace.id).order("occurred_at", { ascending: false }).limit(100),
            supabaseAdmin.from("onboarding_modules").select("id, internal_code, status, updated_at").eq("workspace_id", workspace.id).limit(100),
            supabaseAdmin.from("onboarding_module_revisions").select("id, module_id, revision_number, status, definition, updated_at").eq("workspace_id", workspace.id).order("updated_at", { ascending: false }).limit(200),
            supabaseAdmin.from("onboarding_services").select("id, internal_code, state, updated_at").eq("workspace_id", workspace.id).limit(100),
            supabaseAdmin.from("onboarding_service_revisions").select("id, service_id, revision_number, name, description, is_test, published_at").eq("workspace_id", workspace.id).order("published_at", { ascending: false }).limit(200),
        ])
        for (const okr of (okrs ?? []).filter((item) => includesQuery([item.id, item.objective, item.objective_type, item.description, item.status], query)).slice(0, 6)) {
            const displayTitle = okrDisplayTitle({ objectiveType: okr.objective_type as WorkspaceOkrType | null, objective: okr.objective, deadline: okr.period_end })
            results.push(result(`okr-${okr.id}`, "OKR", displayTitle, okr.description ?? `${okr.status} objective`, `/${workspace.slug}/admin?view=okrs#okr-${okr.id}`, {
                path: `${workspace.name} > Admin > OKRs`, recordId: shortId(okr.id),
            }))
        }
        for (const keyResult of (keyResults ?? []).filter((item) => includesQuery([item.id, item.name, item.description, item.unit, item.comparator], query)).slice(0, 6)) {
            results.push(result(`okr-key-result-${keyResult.id}`, "Key Result", keyResult.name, keyResult.description ?? "Measurable OKR outcome", `/${workspace.slug}/admin?view=okrs#key-result-${keyResult.id}`, {
                path: `${workspace.name} > Admin > OKRs`, recordId: shortId(keyResult.id),
            }))
        }
        for (const event of (adminActivity ?? []).filter((item) => includesQuery([item.id, item.category, item.level, item.event_key, item.summary, item.entity_type, item.entity_id], query)).slice(0, 6)) {
            results.push(result(`admin-activity-${event.id}`, "Admin activity", event.summary, `${event.category} · ${event.level}`, `/${workspace.slug}/admin/activity/${event.id}`, {
                hubHref: `/${workspace.slug}/admin/activity`, path: `${workspace.name} > Admin > Activity`, recordId: shortId(event.id),
            }))
        }
        if (!moduleResult.error && !moduleRevisionResult.error) {
            const latestByModule = new Map<string, (typeof moduleRevisionResult.data)[number]>()
            for (const revision of moduleRevisionResult.data ?? []) if (!latestByModule.has(revision.module_id)) latestByModule.set(revision.module_id, revision)
            for (const moduleMatch of (moduleResult.data ?? []).flatMap((item) => {
                const revision = latestByModule.get(item.id)
                const definition = jsonRecord(revision?.definition)
                const name = typeof definition.name === "string" ? definition.name : item.internal_code
                const description = typeof definition.description === "string" ? definition.description : "Reusable onboarding module"
                return includesQuery([item.id, item.internal_code, name, description], query) ? [{ item, revision, name, description }] : []
            }).slice(0, 6)) results.push(result(`onboarding-module-${moduleMatch.item.id}`, "Onboarding module", moduleMatch.name, moduleMatch.description || `${moduleMatch.revision?.status ?? moduleMatch.item.status} module`, `/${workspace.slug}/onboarding-builder?module=${encodeURIComponent(moduleMatch.item.id)}`, { path: `${workspace.name} > Onboarding Builder`, recordId: shortId(moduleMatch.item.id) }))
        }
        if (!serviceResult.error && !serviceRevisionResult.error) {
            const latestByService = new Map<string, (typeof serviceRevisionResult.data)[number]>()
            for (const revision of serviceRevisionResult.data ?? []) if (!latestByService.has(revision.service_id)) latestByService.set(revision.service_id, revision)
            for (const service of (serviceResult.data ?? []).flatMap((item) => {
                const revision = latestByService.get(item.id)
                const name = revision?.name ?? item.internal_code
                return includesQuery([item.id, item.internal_code, name, revision?.description], query) ? [{ item, revision, name }] : []
            }).slice(0, 6)) results.push(result(`onboarding-service-${service.item.id}`, "Service", service.name, service.revision?.description ?? `${service.item.state} service`, `/${workspace.slug}/settings?service=${encodeURIComponent(service.item.id)}#services`, { path: `${workspace.name} > Settings > Services`, recordId: shortId(service.item.id) }))
        }
    }

    const [
        { data: clients, error: clientError },
        { data: companies, error: companyError },
        { data: polls, error: pollError },
        { data: channels, error: channelError },
        { data: activities, error: activityError },
        { data: assets, error: assetError },
    ] = await Promise.all([
        supabaseAdmin
            .from("clients")
            .select("id, relationship_id, name, email, phone, created_at, archived_at")
            .eq("workspace_id", workspace.id)
            .is("archived_at", null)
            .order("created_at", { ascending: false })
            .limit(80),
        canAccessPrivatePanels
            ? supabaseAdmin
                .from("leadgen_companies")
                .select("id, display_name, legal_name, dba_name, entity_number, owner_name, owner_phone, phone, website_url, source_key, source_record_id, first_seen_poll_id, qualification_status")
                .eq("workspace_id", workspace.id)
                .order("created_at", { ascending: false })
                .limit(80)
            : Promise.resolve({ data: [], error: null }),
        canAccessPrivatePanels
            ? supabaseAdmin
                .from("leadgen_polls")
                .select("id, status, trigger, source_count, candidate_count, qualified_count, error, created_at")
                .eq("workspace_id", workspace.id)
                .order("created_at", { ascending: false })
                .limit(80)
            : Promise.resolve({ data: [], error: null }),
        supabaseAdmin
            .from("client_communication_channels")
            .select("id, client_id, external_address, provider")
            .eq("workspace_id", workspace.id)
            .limit(60),
        supabaseAdmin
            .from("client_activity")
            .select("id, client_id, activity_text, activity_type")
            .eq("workspace_id", workspace.id)
            .order("created_at", { ascending: false })
            .limit(60),
        supabaseAdmin
            .from("assets")
            .select("id, asset_kind, source_kind, title, description, external_url, native_kind, native_id")
            .eq("workspace_id", workspace.id)
            .order("created_at", { ascending: false })
            .limit(80),
    ])

    if (!clientError) {
        for (const client of (clients ?? []).filter((client) => includesQuery([client.id, client.name, client.email, client.phone], query)).slice(0, 6)) {
            const relationship = relationshipByClientId.get(client.id)
            results.push(result(
                `client-${client.id}`,
                "Relationship",
                client.name ?? client.email ?? "Unnamed client",
                client.email ?? client.phone ?? "Onboarding relationship",
                relationship ? onboardingDetailHref(workspace.slug, relationship.id) : client.relationship_id ? onboardingDetailHref(workspace.slug, client.relationship_id) : workspaceHref(workspace.slug, "onboarding"),
                {
                    hubHref: relationship ? onboardingDetailHref(workspace.slug, relationship.id) : client.relationship_id ? onboardingDetailHref(workspace.slug, client.relationship_id) : undefined,
                    path: `${workspace.name} > Onboarding`,
                    recordId: client.id,
                }
            ))
        }
    }

    if (!assetError) {
        for (const asset of (assets ?? []).filter((asset) => includesQuery([asset.id, asset.native_id, asset.asset_kind, asset.source_kind, asset.title, asset.description, asset.external_url, asset.native_kind], query)).slice(0, 6)) {
            results.push(result(
                `asset-${asset.id}`,
                "Asset",
                asset.title,
                "Workspace asset",
                assetHref(workspace.slug, asset.id),
                {
                    hubHref: undefined,
                    path: `${workspace.name} > Library > Assets`,
                    recordId: shortId(asset.id),
                }
            ))
        }
    }

    if (canAccessPrivatePanels && !companyError) {
        for (const company of (companies ?? []).filter((company) => includesQuery([company.id, company.display_name, company.legal_name, company.dba_name, company.entity_number, company.owner_name, company.owner_phone, company.phone, company.website_url, company.source_key, company.source_record_id, company.first_seen_poll_id], query)).slice(0, 5)) {
            results.push(result(
                `leadgen-${company.id}`,
                "Lead",
                company.owner_name ? `${company.owner_name} - ${company.display_name}` : company.display_name,
                [company.qualification_status, company.phone ?? company.owner_phone].filter(Boolean).join(" · ") || "Lead generation result",
                workspaceHref(workspace.slug, "leadgen"),
                {
                    path: `${workspace.name} > Lead Gen > Leads`,
                    recordId: company.id,
                }
            ))
        }
    }

    if (canAccessPrivatePanels && !pollError) {
        for (const poll of (polls ?? []).filter((poll) => includesQuery([poll.id, poll.status, poll.trigger, poll.error], query)).slice(0, 5)) {
            results.push(result(
                `poll-${poll.id}`,
                "Poll",
                `Lead poll ${String(poll.id).slice(0, 8)}`,
                `${poll.status} · ${poll.trigger} · ${poll.qualified_count ?? 0} qualified`,
                workspaceHref(workspace.slug, `leadgen/poll/${poll.id}`),
                {
                    path: `${workspace.name} > Lead Gen > Polls`,
                    recordId: poll.id,
                }
            ))
        }
    }

    if (!channelError) {
        for (const channel of (channels ?? []).filter((channel) => includesQuery([channel.id, channel.client_id, channel.external_address, channel.provider], query)).slice(0, 4)) {
            const relationship = relationshipByClientId.get(channel.client_id)
            results.push(result(
                `contact-${channel.id}`,
                "Contact",
                channel.external_address,
                channel.provider,
                relationship ? communicationsHref(workspace.slug) : communicationsHref(workspace.slug),
                {
                    hubHref: relationship ? communicationsHref(workspace.slug) : undefined,
                    path: `${workspace.name} > Communications`,
                    recordId: channel.id,
                }
            ))
        }
    }

    if (!activityError) {
        for (const activity of (activities ?? []).filter((activity) => includesQuery([activity.id, activity.client_id, activity.activity_text, activity.activity_type], query)).slice(0, 4)) {
            const relationship = relationshipByClientId.get(activity.client_id)
            results.push(result(
                `activity-${activity.id}`,
                "Activity",
                activity.activity_text,
                activity.activity_type,
                relationship ? onboardingDetailHref(workspace.slug, relationship.id) : workspaceHref(workspace.slug, "onboarding"),
                {
                    hubHref: relationship ? onboardingDetailHref(workspace.slug, relationship.id) : undefined,
                    path: `${workspace.name} > Onboarding > Recent Activity`,
                    recordId: activity.id,
                }
            ))
        }
    }

    return Response.json({ results: results.slice(0, 20) })
}
