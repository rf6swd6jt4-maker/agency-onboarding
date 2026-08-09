import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { LeadgenTabs } from "@/components/leadgen/LeadgenTabs"
import { NewPollButton } from "@/components/leadgen/NewPollButton"
import { PollDuration } from "@/components/leadgen/PollDuration"
import { PollsAutoRefresh } from "@/components/leadgen/PollsAutoRefresh"
import { ListActionMenu } from "@/components/list/ListActionMenu"
import { ListCreatorBadge } from "@/components/list/ListCreatorBadge"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { MobileListActionSurface } from "@/components/list/MobileCardActionSurface"
import { SquarePill } from "@/components/ui/SquarePill"
import { Status } from "@/components/ui/Status"
import type { StatusTone } from "@/components/ui/status-styles"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { sourceLabel } from "@/lib/leadgen/sources"
import { profileAvatarUrl } from "@/lib/profile-avatar"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { compactText, formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspace, workspaceRoleLabel } from "@/lib/workspaces"
import { cancelLeadgenPoll, removeLeadgenPoll, retryLeadgenPoll } from "../actions"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ workspaceSlug: string }> }
type PollStatus = "queued" | "running" | "completed" | "failed" | "cancelled"
type PollTask = {
    id: string
    poll_id: string
    status: string
    source_key: string
    industry_value: string | null
    location_value: string | null
    raw_count: number | null
    company_count: number | null
    error: string | null
    created_at: string
}
type InvestigationTask = {
    id: string
    poll_id: string
    status: string
    source_key: string
    matched: boolean | null
    error: string | null
    skip_reason: string | null
    created_at: string
}
type EvidenceClaim = {
    id: string
    poll_id: string
    claim_kind: string
}

const statusStyles: Record<PollStatus, { label: string; tone: StatusTone }> = {
    queued: { label: "Initialising", tone: "grey" },
    running: { label: "In progress", tone: "yellow" },
    completed: { label: "Successful", tone: "green" },
    failed: { label: "Failed", tone: "red" },
    cancelled: { label: "Cancelled", tone: "red" },
}

function statusMeta(status: string) {
    return statusStyles[(status as PollStatus) in statusStyles ? status as PollStatus : "queued"]
}

function sourceNames(snapshot: unknown, count: number) {
    if (!Array.isArray(snapshot) || snapshot.length === 0) return count ? `${count} configured` : "Source"
    return snapshot
        .map((source) => {
            if (!source || typeof source !== "object" || !("key" in source)) return null
            const industries = "industries" in source && Array.isArray(source.industries) ? source.industries.length : 0
            const locations = "locations" in source && Array.isArray(source.locations) ? source.locations.length : 0
            const detail = [industries ? `${industries} industries` : null, locations ? `${locations} locations` : null].filter(Boolean).join(", ")
            return `${sourceLabel(String(source.key))}${detail ? ` (${detail})` : ""}`
        })
        .filter((label): label is string => Boolean(label))
        .join(", ") || `${count} configured`
}

function pollTaskStats(tasks: PollTask[]) {
    return {
        sourceQueries: tasks.length,
        completedQueries: tasks.filter((task) => task.status === "completed").length,
        rawReturned: tasks.reduce((total, task) => total + (task.raw_count ?? 0), 0),
        numbersReturned: tasks.reduce((total, task) => total + (task.company_count ?? 0), 0),
    }
}

function investigationStats(tasks: InvestigationTask[], claims: EvidenceClaim[]) {
    return {
        checks: tasks.length,
        matched: tasks.filter((task) => task.matched).length,
        failed: tasks.filter((task) => task.status === "failed" || task.error).length,
        skipped: tasks.filter((task) => task.status === "skipped").length,
        claims: claims.length,
        ownerClaims: claims.filter((claim) => ["owner_identity", "officer_identity", "owner_phone"].includes(claim.claim_kind)).length,
    }
}

export default async function LeadgenPollsPage({ params }: PageProps) {
    const { workspaceSlug } = await params
    const { workspace, user, role } = await requireWorkspace(workspaceSlug, "admin")
    const pollsResult = await supabaseAdmin
        .from("leadgen_polls")
        .select("id, requested_by, status, trigger, source_count, source_snapshot, candidate_count, normalised_count, deduped_count, enriched_count, qualified_count, created_at, started_at, completed_at, error")
        .eq("workspace_id", workspace.id)
        .order("created_at", { ascending: false })
        .limit(40)
    const polls = pollsResult.error ? [] : pollsResult.data ?? []
    const creatorIds = [...new Set(polls.map((poll) => poll.requested_by).filter(Boolean))] as string[]
    const { data: creators } = creatorIds.length
        ? await supabaseAdmin.from("user_profiles").select("user_id, username, avatar_path").in("user_id", creatorIds)
        : { data: [] as Array<{ user_id: string; username: string; avatar_path: string | null }> }
    const creatorById = new Map((creators ?? []).map((creator) => [creator.user_id, creator]))

    const tasksResult = polls.length ? await supabaseAdmin
        .from("leadgen_poll_tasks")
        .select("id, poll_id, status, source_key, industry_value, location_value, raw_count, company_count, error, created_at")
        .in("poll_id", polls.map((poll) => poll.id))
        .order("created_at", { ascending: true }) : { data: [], error: null }
    const pollTasks = (tasksResult.error ? [] : tasksResult.data ?? []) as PollTask[]
    const tasksByPoll = pollTasks.reduce<Record<string, PollTask[]>>((groups, task) => {
        groups[task.poll_id] = [...(groups[task.poll_id] ?? []), task]
        return groups
    }, {})
    const investigationResult = polls.length ? await supabaseAdmin
        .from("leadgen_investigation_tasks")
        .select("id, poll_id, status, source_key, matched, error, skip_reason, created_at")
        .in("poll_id", polls.map((poll) => poll.id))
        .order("created_at", { ascending: true }) : { data: [], error: null }
    const investigationTasks = (investigationResult.error ? [] : investigationResult.data ?? []) as InvestigationTask[]
    const investigationsByPoll = investigationTasks.reduce<Record<string, InvestigationTask[]>>((groups, task) => {
        groups[task.poll_id] = [...(groups[task.poll_id] ?? []), task]
        return groups
    }, {})
    const claimsResult = polls.length ? await supabaseAdmin
        .from("leadgen_evidence_claims")
        .select("id, poll_id, claim_kind")
        .in("poll_id", polls.map((poll) => poll.id)) : { data: [], error: null }
    const claims = (claimsResult.error ? [] : claimsResult.data ?? []) as EvidenceClaim[]
    const claimsByPoll = claims.reduce<Record<string, EvidenceClaim[]>>((groups, claim) => {
        groups[claim.poll_id] = [...(groups[claim.poll_id] ?? []), claim]
        return groups
    }, {})
    const livePolls = polls.filter((poll) => ["queued", "running"].includes(poll.status))
    const latestPoll = polls[0]
    const latestTaskStats = latestPoll ? pollTaskStats(tasksByPoll[latestPoll.id] ?? []) : null
    const latestInvestigationStats = latestPoll ? investigationStats(investigationsByPoll[latestPoll.id] ?? [], claimsByPoll[latestPoll.id] ?? []) : null

    return <main className="min-h-screen bg-neutral-950 px-4 py-5 text-white sm:px-6 sm:py-6">
        <PollsAutoRefresh enabled intervalMs={5000} processUrl={`/api/leadgen/polls/process?workspace=${encodeURIComponent(workspace.slug)}`} />
        <div className="mx-auto max-w-7xl">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="leadgen" />
            <WorkspaceBanner bannerPath={workspace.banner_path} logoPath={workspace.logo_path} name={workspace.name} height={workspace.banner_height} position={workspace.banner_position} />
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Polls</h1>
                    <p className="mt-2 text-sm text-neutral-400">Track source polling, queue state, run durations, and pipeline counts. Signed in as {workspaceRoleLabel(role)}.</p>
                </div>
                <NewPollButton href={`/${workspace.slug}/leadgen/new`} />
            </div>

            <LeadgenTabs workspaceSlug={workspace.slug} active="polls" />

            <div className="mt-5 grid grid-cols-3 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 sm:grid-cols-4 sm:gap-3 sm:overflow-visible sm:rounded-none sm:border-0 sm:bg-transparent">
                {[
                    ["Running", livePolls.length, ""],
                    ["History", polls.length, ""],
                    ["Source checks", latestInvestigationStats?.checks ?? 0, "hidden sm:block"],
                    ["Raw returned", latestTaskStats?.rawReturned ?? 0, ""],
                ].map(([label, value, className]) => <div key={label} className={`${className} border-r border-neutral-800 px-2 py-2 text-center last:border-r-0 sm:rounded-lg sm:border sm:border-neutral-800 sm:bg-neutral-900 sm:px-3 sm:text-left`}>
                    <p className="text-[10px] leading-tight text-neutral-500 sm:text-xs">{label}</p>
                    <p className="mt-1 text-lg font-semibold">{value}</p>
                </div>)}
            </div>

            <List ariaLabel="Lead generation polls">
                {polls.length ? polls.map((poll) => {
                    const meta = statusMeta(poll.status)
                    const live = ["queued", "running"].includes(poll.status)
                    const tasks = tasksByPoll[poll.id] ?? []
                    const taskStats = pollTaskStats(tasks)
                    const investigations = investigationsByPoll[poll.id] ?? []
                    const claimStats = investigationStats(investigations, claimsByPoll[poll.id] ?? [])
                    const failedTasks = tasks.filter((task) => task.error || task.status === "failed")
                    const failedInvestigations = investigations.filter((task) => task.error || task.status === "failed")
                    const hasConsoleEntry = poll.status === "failed" || failedTasks.length > 0
                        || failedInvestigations.length > 0
                    const creator = poll.requested_by ? creatorById.get(poll.requested_by) : null
                    const creatorAvatarSrc = creator?.avatar_path && creator.username ? profileAvatarUrl(creator.username, creator.avatar_path) : null
                    const duration = <span className="font-mono text-sm text-neutral-500"><PollDuration startedAt={poll.started_at} createdAt={poll.created_at} completedAt={poll.completed_at} live={live} /></span>
                    const pollHref = `/${workspace.slug}/leadgen/poll/${poll.id}`
                    const pollActions = [
                        { label: "Open poll", href: pollHref },
                        poll.status === "failed" ? { label: "Retry", action: retryLeadgenPoll.bind(null, workspace.slug, poll.id) } : {},
                        hasConsoleEntry ? { label: "Open console", href: `#poll-console-${poll.id}` } : {},
                        live ? { label: "Cancel", action: cancelLeadgenPoll.bind(null, workspace.slug, poll.id), danger: true, confirmMessage: "Cancel this running poll?" } : {},
                        { label: "Remove", action: removeLeadgenPoll.bind(null, workspace.slug, poll.id), danger: true },
                    ]
                    return <ListItem key={poll.id} className={poll.status === "failed" ? "bg-red-950/[0.08]" : ""}>
                        <MobileListActionSurface actions={pollActions} label={`Open actions for ${sourceNames(poll.source_snapshot, poll.source_count)} poll`}>
                        <ListPrimaryRow>
                            <ListTitle href={pollHref} className="flex-1">{sourceNames(poll.source_snapshot, poll.source_count)} poll</ListTitle>
                            <SquarePill className="shrink-0">{poll.trigger === "manual" ? "Manual" : "Automated"}</SquarePill>
                            <span className="ml-auto flex shrink-0 items-center gap-3">
                                <Status label={meta.label} tone={meta.tone} />
                                {duration}
                            </span>
                        </ListPrimaryRow>
                        <ListSecondaryRow>
                            <span className="shrink-0 text-neutral-500"><span className="text-neutral-200">{taskStats.completedQueries}</span>/<span className="text-neutral-200">{taskStats.sourceQueries}</span> seed</span>
                            <span className="hidden shrink-0 text-neutral-500 sm:inline"><span className="text-neutral-200">{taskStats.rawReturned}</span> raw</span>
                            <span className="hidden shrink-0 text-neutral-500 md:inline"><span className="text-neutral-200">{claimStats.matched}</span>/<span className="text-neutral-200">{claimStats.checks}</span> checks</span>
                            <span className="hidden shrink-0 text-neutral-500 lg:inline"><span className="text-neutral-200">{claimStats.ownerClaims}</span> owner claims</span>
                            <span className="shrink-0 text-neutral-500"><span className="text-neutral-200">{poll.qualified_count}</span> qualified</span>
                            <ListTrailing>
                                <span className="font-mono text-neutral-500">{shortId(poll.id)}</span>
                                <span className="whitespace-nowrap text-neutral-500">{formatRelativeTime(poll.created_at)}</span>
                                <ListCreatorBadge src={creatorAvatarSrc} username={creator?.username ?? null} label="Created by" date={new Date(poll.created_at).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })} />
                                <ListActionMenu actions={pollActions} className="hidden sm:block" />
                            </ListTrailing>
                        </ListSecondaryRow>
                        </MobileListActionSurface>
                    </ListItem>
                }) : <div className="p-5">
                    <h3 className="text-xl font-semibold">Run your first test poll.</h3>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-400">This will queue a poll record and run the configured sources.</p>
                </div>}
            </List>

            {polls.some((poll) => poll.status === "failed" || (tasksByPoll[poll.id] ?? []).some((task) => task.error || task.status === "failed") || (investigationsByPoll[poll.id] ?? []).some((task) => task.error || task.status === "failed")) && <section className="mt-5 rounded-2xl border border-neutral-800 bg-black">
                <div className="border-b border-neutral-800 px-5 py-4">
                    <h2 className="font-semibold">Poll console</h2>
                    <p className="mt-1 text-sm text-neutral-500">Open console from a failed poll to jump to its source errors.</p>
                </div>
                {polls.map((poll) => {
                    const failedTasks = (tasksByPoll[poll.id] ?? []).filter((task) => task.error || task.status === "failed")
                    const failedInvestigations = (investigationsByPoll[poll.id] ?? []).filter((task) => task.error || task.status === "failed")
                    if (poll.status !== "failed" && failedTasks.length === 0 && failedInvestigations.length === 0) return null
                    const firstError = poll.error ?? failedTasks.find((task) => task.error)?.error ?? failedInvestigations.find((task) => task.error)?.error ?? "Poll failed without a task-level error. Retry the poll; if this repeats, the source worker could not create or read its source tasks."
                    const pollMeta = statusMeta(poll.status === "failed" ? "failed" : failedTasks[0]?.status ?? "failed")
                    return <div id={`poll-console-${poll.id}`} key={poll.id} className="grid min-h-14 scroll-mt-24 gap-3 border-b border-neutral-900 px-4 py-3 last:border-0 md:grid-cols-[140px_minmax(0,1fr)_120px] md:items-center">
                        <Status label={pollMeta.label} tone={pollMeta.tone} />
                        <details className="min-w-0 text-sm">
                            <summary className="cursor-pointer truncate text-red-300">{compactText(firstError, 220)}</summary>
                            <div className="mt-2 space-y-2">
                                {failedTasks.length || failedInvestigations.length ? [...failedTasks.map((task) => ({ id: task.id, error: task.error ?? `${task.source_key} task failed without a detailed error.` })), ...failedInvestigations.map((task) => ({ id: task.id, error: task.error ?? `${task.source_key} candidate check failed without a detailed error.` }))].map((task) => (
                                    <p key={task.id} className="whitespace-pre-wrap break-words rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-xs text-red-100">
                                        {task.error}
                                    </p>
                                )) : <p className="whitespace-pre-wrap break-words rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-xs text-red-100">{firstError}</p>}
                            </div>
                        </details>
                        <p className="font-mono text-xs text-neutral-500">{shortId(poll.id)}</p>
                    </div>
                })}
            </section>}
            <p className="mt-10 text-center text-xs text-neutral-600">Betelgeze © 2026</p>
        </div>
    </main>
}
