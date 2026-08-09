import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { LeadgenTabs } from "@/components/leadgen/LeadgenTabs"
import { NewPollButton } from "@/components/leadgen/NewPollButton"
import { ListActionMenu } from "@/components/list/ListActionMenu"
import { ListAutoRefresh } from "@/components/list/ListAutoRefresh"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { ListCreatorBadge } from "@/components/list/ListCreatorBadge"
import { Status } from "@/components/ui/Status"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspace, workspaceRoleLabel } from "@/lib/workspaces"
import { promoteLeadgenCompanyToRelationship, removeLeadgenCompany } from "./actions"
import { relationshipHubHref } from "@/lib/relationships"
import { LEADGEN_POLLING_SYSTEM_VERSION_LABEL } from "@/lib/leadgen/version"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ workspaceSlug: string }>; searchParams: Promise<{ relationshipError?: string }> }

export default async function LeadgenWorkspacePage({ params, searchParams }: PageProps) {
    const { workspaceSlug } = await params
    const { relationshipError } = await searchParams
    const { workspace, user, role } = await requireWorkspace(workspaceSlug, "admin")
    const latestPollResult = await supabaseAdmin
        .from("leadgen_polls")
        .select("id, status, created_at")
        .eq("workspace_id", workspace.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    const latestPoll = latestPollResult.error ? null : latestPollResult.data
    const companiesResult = await supabaseAdmin
        .from("leadgen_companies")
        .select("id, display_name, phone, owner_name, owner_phone, website_url, profile_url, source_key, address, rating, review_count, industry_value, location_value, owner_identity_points, owner_phone_points, business_support_points, lead_score, qualification_status, created_at")
        .eq("workspace_id", workspace.id)
        .eq("first_seen_poll_id", latestPoll?.id ?? "00000000-0000-0000-0000-000000000000")
        .eq("qualification_status", "qualified")
        .order("lead_score", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(100)
    const companies = (companiesResult.error ? [] : companiesResult.data ?? []).filter((company) => Boolean(company.owner_name && company.owner_phone))
    const relationshipResult = companies.length
        ? await supabaseAdmin
            .from("relationships")
            .select("id, leadgen_company_id")
            .eq("workspace_id", workspace.id)
            .in("leadgen_company_id", companies.map((company) => company.id))
        : { data: [] as Array<{ id: string; leadgen_company_id: string | null }>, error: null }
    const relationshipByCompanyId = new Map((relationshipResult.error ? [] : relationshipResult.data ?? []).map((relationship) => [relationship.leadgen_company_id, relationship.id]))
    const callable = companies.filter((company) => Boolean(company.owner_phone)).length
    const withProfiles = companies.filter((company) => Boolean(company.profile_url || company.website_url)).length
    function locationLabel(address: unknown) {
        if (!address || typeof address !== "object") return "Location unknown"
        const details = address as Record<string, unknown>
        const city = typeof details.city === "string" && details.city.trim() ? details.city.trim() : ""
        const locality = typeof details.locality === "string" && details.locality.trim() ? details.locality.trim() : ""
        const state = typeof details.state === "string" && details.state.trim()
            ? details.state.trim()
            : typeof details.region === "string" && details.region.trim()
                ? details.region.trim()
                : ""
        const place = [city || locality, state].filter(Boolean).join(", ")
        return place || "Location unknown"
    }

    return <main className="min-h-screen bg-neutral-950 px-4 py-5 text-white sm:px-6 sm:py-6">
        <ListAutoRefresh />
        <div className="mx-auto max-w-7xl">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="leadgen" />
            <WorkspaceBanner bannerPath={workspace.banner_path} logoPath={workspace.logo_path} name={workspace.name} height={workspace.banner_height} position={workspace.banner_position} />
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Lead Gen <span className="font-mono text-lg text-neutral-500">{LEADGEN_POLLING_SYSTEM_VERSION_LABEL}</span></h1>
                    <p className="mt-2 text-sm text-neutral-400">Review qualified owner-phone leads from the latest poll. Research candidates and rejected evidence stay on the poll detail page. Signed in as {workspaceRoleLabel(role)}.</p>
                </div>
                <NewPollButton href={`/${workspace.slug}/leadgen/new`} />
            </div>

            <LeadgenTabs workspaceSlug={workspace.slug} active="leads" />

            {relationshipError && <div className="mt-5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {relationshipError === "not-ready" ? "This lead needs a person and contact path before it can become a Relationship." : "Relationships are not ready in the database yet. Apply the latest Supabase migration, then try again."}
            </div>}

            <div className="mt-5 grid grid-cols-3 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 sm:gap-3 sm:overflow-visible sm:rounded-none sm:border-0 sm:bg-transparent sm:grid-cols-3">
                {[
                    ["Qualified leads", companies.length],
                    ["Owner phones", callable],
                    ["Source links", withProfiles],
                ].map(([label, value]) => <div key={label} className="border-r border-neutral-800 px-2 py-2 text-center last:border-r-0 sm:rounded-lg sm:border sm:border-neutral-800 sm:bg-neutral-900 sm:px-3 sm:text-left">
                    <p className="text-[10px] leading-tight text-neutral-500 sm:text-xs">{label}</p>
                    <p className="mt-1 text-lg font-semibold">{value}</p>
                </div>)}
            </div>

            <List ariaLabel="Qualified leads">
                {companies.length ? companies.map((company) => {
                    const sourceUrl = company.website_url ?? company.profile_url ?? null
                    const bestPhone = company.owner_phone
                    const ownerName = company.owner_name ?? "Owner not found"
                    const location = locationLabel(company.address)
                    const titleLine = `${ownerName} - ${company.display_name}`
                    const industry = String(company.industry_value ?? "—").replace(/_/g, " ")
                    const scoreLine = `Score ${company.lead_score ?? 0} · owner ${company.owner_identity_points ?? 0}/${company.owner_phone_points ?? 0}`
                    const copyLine = `${ownerName}: ${bestPhone ?? "No owner phone"} - ${company.display_name}, ${industry}, ${location}. ${scoreLine}`
                    const relationshipId = relationshipByCompanyId.get(company.id)
                    const leadHref = relationshipId ? relationshipHubHref(workspace.slug, relationshipId) : sourceUrl
                    const leadActions = [
                        relationshipId ? { label: "Open relationship", href: relationshipHubHref(workspace.slug, relationshipId) } : { label: "Create relationship", action: promoteLeadgenCompanyToRelationship.bind(null, workspace.slug, company.id) },
                        sourceUrl ? { label: "Open source", href: sourceUrl, external: true } : {},
                        { label: "Copy lead details", copyText: copyLine },
                        { label: "Remove", action: removeLeadgenCompany.bind(null, workspace.slug, company.id), danger: true },
                    ]
                    return <ListItem key={company.id}>
                        <ListPrimaryRow>
                            <ListTitle href={leadHref} external={!relationshipId && Boolean(sourceUrl)} className="flex-1">{titleLine}</ListTitle>
                            <Status label={bestPhone ? "Callable" : "No phone"} tone={bestPhone ? "green" : "grey"} className="ml-auto shrink-0" />
                        </ListPrimaryRow>
                        <ListSecondaryRow>
                            <span className="min-w-0 truncate text-neutral-200">{bestPhone || "No phone"}</span>
                            <span className="hidden min-w-0 truncate capitalize text-neutral-400 sm:inline">{company.source_key}</span>
                            <span className="hidden min-w-0 truncate text-neutral-400 md:inline">{industry}</span>
                            <span className="hidden min-w-0 truncate text-neutral-500 lg:inline">{location}</span>
                            <span className="hidden shrink-0 font-mono text-neutral-500 sm:inline">{company.lead_score ?? 0} pts</span>
                            <ListTrailing>
                                <span className="hidden font-mono text-neutral-500 sm:inline">{shortId(company.id)}</span>
                                <span className="whitespace-nowrap text-neutral-500">{formatRelativeTime(company.created_at)}</span>
                                <ListCreatorBadge username={null} label="Added by" date={new Date(company.created_at).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })} />
                                <ListActionMenu actions={leadActions} />
                            </ListTrailing>
                        </ListSecondaryRow>
                    </ListItem>
                }) : <div className="grid gap-4 p-5 lg:grid-cols-[1.1fr_0.9fr]">
                    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-5">
                        <h3 className="text-xl font-semibold">{latestPoll ? "This poll did not return qualified leads." : "No real companies have been collected yet."}</h3>
                        <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-400">{latestPoll ? "The Leads tab only shows companies from the latest poll where source-backed owner identity and owner phone evidence both cleared the qualification threshold. Raw candidates, skipped checks, and rejected reasons are preserved inside the poll detail page." : "Configure Overture plus ICP industries and locations in Settings, then run a poll. Candidates will be investigated across the active public-source catalogue before anything appears here."}</p>
                    </div>
                    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-5">
                        <h3 className="text-xl font-semibold">Next action</h3>
                        <ul className="mt-3 space-y-2 text-sm text-neutral-300">
                            <li>• Check Settings to confirm Overture and the active fan-out catalogue are ready.</li>
                            <li>• Run a 10-business test poll from New Poll.</li>
                            <li>• Open the poll detail page to inspect candidates, evidence, and rejection reasons.</li>
                        </ul>
                    </div>
                </div>}
            </List>
            <p className="mt-10 text-center text-xs text-neutral-600">Betelgeze © 2026</p>
        </div>
    </main>
}
