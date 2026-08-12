import { notFound } from "next/navigation"
import { BetelgezeStatusMark } from "@/components/brand/BetelgezeStatusMark"
import { DetailDangerAction, DetailDangerButton, DetailDangerZone, DetailField, DetailFields, DetailPageHeader } from "@/components/detail"
import { PollDuration } from "@/components/leadgen/PollDuration"
import { PollLiveRefresh } from "@/components/leadgen/PollLiveRefresh"
import { SquarePill, Status, type StatusTone } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { sourceCatalogMap, sourceHumanLabel, type LeadgenSourceCatalogRow } from "@/lib/leadgen/source-catalog-ui"
import { sourceLabel } from "@/lib/leadgen/sources"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ workspaceSlug: string; pollId: string }> }

const statusStyles: Record<string, { label: string; mark: string; text: string; tone: StatusTone }> = {
    queued: { label: "Initialising", mark: "bg-neutral-400", text: "text-neutral-300", tone: "grey" },
    running: { label: "In progress", mark: "bg-yellow-300", text: "text-yellow-200", tone: "yellow" },
    completed: { label: "Completed", mark: "bg-emerald-300", text: "text-emerald-200", tone: "green" },
    failed: { label: "Failed", mark: "bg-red-300", text: "text-red-200", tone: "red" },
    cancelled: { label: "Cancelled", mark: "bg-red-300", text: "text-red-200", tone: "red" },
}

function statusMeta(status: string) {
    return statusStyles[status] ?? statusStyles.queued
}

function jsonPreview(value: unknown) {
    return JSON.stringify(value ?? {}, null, 2)
}

function JsonPreviewBlock({ value, maxHeight = "max-h-72", tone = "black" }: { value: unknown; maxHeight?: "max-h-72" | "max-h-80"; tone?: "black" | "neutral" }) {
    const background = tone === "neutral" ? "bg-neutral-950" : "bg-black"
    return <pre className={`mt-3 block ${maxHeight} w-full max-w-full overflow-auto rounded-lg border border-neutral-800 ${background} p-3 text-xs text-neutral-300 whitespace-pre`}>{jsonPreview(value)}</pre>
}

function sourceNames(snapshot: unknown, count: number) {
    if (!Array.isArray(snapshot) || snapshot.length === 0) return count ? `${count} configured sources` : "No source snapshot"
    return snapshot
        .map((source) => source && typeof source === "object" && "key" in source ? sourceLabel(String(source.key)) : null)
        .filter((value): value is string => Boolean(value))
        .join(", ")
}

const stageDefinitions = [
    {
        key: "seed",
        title: "Seed businesses",
        detail: "Seed sources collect the backup pool of candidate businesses.",
        passedLabel: "seeded",
    },
    {
        key: "business_validation",
        title: "Business validation",
        detail: "The seed pool is validated as a batch; failed businesses are replaced by backup seed candidates until the target set is filled.",
        passedLabel: "validated",
    },
    {
        key: "owner_identity",
        title: "Owner identity",
        detail: "The validated batch is checked for a credible owner, principal, or authorised official name.",
        passedLabel: "owners",
    },
    {
        key: "owner_phone",
        title: "Owner phone discovery",
        detail: "Only businesses with owner identity evidence move into owner phone discovery.",
        passedLabel: "numbers",
    },
    {
        key: "phone_validation",
        title: "Phone validation",
        detail: "Discovered owner numbers are checked for callable formatting now; line-type/mobile validation can replace this later.",
        passedLabel: "callable",
    },
] as const

type StageKey = typeof stageDefinitions[number]["key"]

function normalisedStageKey(value: unknown): StageKey | null {
    return stageDefinitions.some((stage) => stage.key === value) ? value as StageKey : null
}

function taskStageKey(task: { stage_key?: string | null; stage?: string | null; source_key?: string | null }) {
    const explicit = normalisedStageKey(task.stage_key)
    if (explicit) return explicit
    if (["overture", "osm", "alltheplaces", "foursquare_os_places"].includes(task.source_key ?? "") || task.stage === "candidate_seed") return "seed"
    if (task.stage === "phone_validation") return "phone_validation"
    return "business_validation"
}

function investigationStageKey(task: { stage_key?: string | null }) {
    return normalisedStageKey(task.stage_key) ?? "business_validation"
}

function formatDuration(startedAt: string | null | undefined, completedAt: string | null | undefined) {
    if (!startedAt) return "Not started"
    const end = completedAt ? new Date(completedAt).getTime() : Date.now()
    const start = new Date(startedAt).getTime()
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "Running"
    const seconds = Math.max(0, Math.round((end - start) / 1000))
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    if (minutes < 60) return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
    const hours = Math.floor(minutes / 60)
    const remainingMinutes = minutes % 60
    return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}

function evidenceSignalLabel(item: { owner_identity_points?: number | null; owner_phone_points?: number | null; business_support_points?: number | null }) {
    const signals = [
        Number(item.owner_identity_points ?? 0) > 0 ? "owner" : null,
        Number(item.owner_phone_points ?? 0) > 0 ? "owner phone" : null,
        Number(item.business_support_points ?? 0) > 0 ? "business" : null,
    ].filter((signal): signal is string => Boolean(signal))
    return signals.length ? signals.join(" + ") : "no evidence"
}

function numericScore(value: unknown) {
    const score = Number(value ?? 0)
    return Number.isFinite(score) ? score : 0
}

function countSourceKeys(value: unknown) {
    return Array.isArray(value) ? value.filter(Boolean).length : 0
}

function plural(value: number, singular: string, pluralLabel = `${singular}s`) {
    return `${value} ${value === 1 ? singular : pluralLabel}`
}

export default async function LeadgenPollObjectPage({ params }: PageProps) {
    const { workspaceSlug, pollId } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    const pollResult = await supabaseAdmin
        .from("leadgen_polls")
        .select("id, requested_by, status, trigger, source_count, source_snapshot, icp_snapshot, candidate_count, normalised_count, deduped_count, enriched_count, qualified_count, current_stage, target_validated_count, max_seed_candidates, seeded_count, validation_passed_count, owner_identity_count, owner_phone_count, callable_phone_count, stage_summary, created_at, started_at, completed_at, error")
        .eq("workspace_id", workspace.id)
        .eq("id", pollId)
        .maybeSingle()
    if (pollResult.error || !pollResult.data) notFound()
    const poll = pollResult.data
    const [tasksResult, recordsResult, companiesResult, evidenceResult, investigationResult, claimsResult, scoresResult, catalogResult, stageRunsResult, companyStagesResult] = await Promise.all([
        supabaseAdmin
            .from("leadgen_poll_tasks")
            .select("id, source_key, stage_key, stage, industry_value, location_value, status, source_query, raw_count, company_count, error, started_at, completed_at, created_at")
            .eq("poll_id", poll.id)
            .eq("workspace_id", workspace.id)
            .order("created_at", { ascending: true }),
        supabaseAdmin
            .from("leadgen_source_records")
            .select("id, source_key, source_record_id, company_name, phone, website_url, profile_url, address, categories, raw_payload, created_at")
            .eq("poll_id", poll.id)
            .eq("workspace_id", workspace.id)
            .order("created_at", { ascending: false })
            .limit(200),
        supabaseAdmin
            .from("leadgen_companies")
            .select("id, display_name, phone, owner_name, owner_phone, owner_source_key, website_url, profile_url, source_key, source_record_id, industry_value, location_value, address, owner_evidence, owner_identity_points, owner_phone_points, business_support_points, lead_score, qualification_status, disqualification_reason, created_at")
            .eq("first_seen_poll_id", poll.id)
            .eq("workspace_id", workspace.id)
            .order("created_at", { ascending: false })
            .limit(200),
        supabaseAdmin
            .from("leadgen_evidence")
            .select("id, source_key, evidence_kind, confidence, value, raw_payload, company_id, created_at")
            .eq("poll_id", poll.id)
            .eq("workspace_id", workspace.id)
            .order("created_at", { ascending: false })
            .limit(200),
        supabaseAdmin
            .from("leadgen_investigation_tasks")
            .select("id, company_id, stage_key, source_key, status, matched, skip_reason, error, owner_identity_points, owner_phone_points, business_support_points, created_at, completed_at")
            .eq("poll_id", poll.id)
            .eq("workspace_id", workspace.id)
            .order("created_at", { ascending: true })
            .limit(500),
        supabaseAdmin
            .from("leadgen_evidence_claims")
            .select("id, company_id, source_key, claim_kind, points_awarded, confidence, claim_value, provenance_url, created_at")
            .eq("poll_id", poll.id)
            .eq("workspace_id", workspace.id)
            .order("created_at", { ascending: false })
            .limit(500),
        supabaseAdmin
            .from("leadgen_candidate_scores")
            .select("company_id, owner_identity_points, owner_phone_points, business_support_points, total_score, qualification_status, disqualification_reason, best_owner_name, best_owner_phone")
            .eq("poll_id", poll.id)
            .eq("workspace_id", workspace.id),
        supabaseAdmin
            .from("leadgen_source_catalog")
            .select("source_key, label, family, source_points, owner_identity_points, owner_phone_points, business_support_points, access_method, free_status, implementation_status, run_stage, enabled, rate_limit_ms, coverage, metadata"),
        supabaseAdmin
            .from("leadgen_poll_stage_runs")
            .select("id, stage_key, stage_order, status, target_count, input_count, passed_count, failed_count, skipped_count, replaced_count, error, metrics, started_at, completed_at, created_at")
            .eq("poll_id", poll.id)
            .eq("workspace_id", workspace.id)
            .order("stage_order", { ascending: true }),
        supabaseAdmin
            .from("leadgen_company_stage_status")
            .select("id, company_id, stage_key, status, source_keys, score, reason, metrics, completed_at")
            .eq("poll_id", poll.id)
            .eq("workspace_id", workspace.id)
            .order("created_at", { ascending: true })
            .limit(1000),
    ])
    const tasks = tasksResult.error ? [] : tasksResult.data ?? []
    const records = recordsResult.error ? [] : recordsResult.data ?? []
    const companies = companiesResult.error ? [] : companiesResult.data ?? []
    const evidence = evidenceResult.error ? [] : evidenceResult.data ?? []
    const investigations = investigationResult.error ? [] : investigationResult.data ?? []
    const claims = claimsResult.error ? [] : claimsResult.data ?? []
    const scores = scoresResult.error ? [] : scoresResult.data ?? []
    const catalog = (catalogResult.error ? [] : catalogResult.data ?? []) as LeadgenSourceCatalogRow[]
    const stageRuns = stageRunsResult.error ? [] : stageRunsResult.data ?? []
    const companyStages = companyStagesResult.error ? [] : companyStagesResult.data ?? []
    const sourcesByKey = sourceCatalogMap(catalog)
    const companyById = new Map(companies.map((company) => [company.id, company]))
    const scoreByCompany = new Map(scores.map((score) => [score.company_id, score]))
    const ownerIdentityClaimCount = claims.filter((claim) => ["owner_identity", "officer_identity"].includes(claim.claim_kind)).length
    const ownerPhoneClaimCount = claims.filter((claim) => claim.claim_kind === "owner_phone").length
    const meta = statusMeta(poll.status)
    const live = ["queued", "running"].includes(poll.status)
    const consoleRows = [
        ...tasks.filter((task) => task.error).map((task) => ({ id: task.id, label: `${sourceHumanLabel(task.source_key, sourcesByKey, sourceLabel)}/${task.stage ?? "task"}`, error: task.error })),
        ...investigations.filter((task) => task.error).map((task) => ({ id: task.id, label: `${sourceHumanLabel(task.source_key, sourcesByKey, sourceLabel)}/candidate check`, error: task.error })),
    ].filter((row): row is { id: string; label: string; error: string } => Boolean(row.error))
    const stageRunsByKey = new Map(stageRuns.map((stage) => [stage.stage_key, stage]))
    const sourceTasksByStage = new Map<StageKey, typeof tasks>()
    const investigationTasksByStage = new Map<StageKey, typeof investigations>()
    const companyStagesByStage = new Map<StageKey, typeof companyStages>()
    for (const stage of stageDefinitions) {
        sourceTasksByStage.set(stage.key, tasks.filter((task) => taskStageKey(task) === stage.key))
        investigationTasksByStage.set(stage.key, investigations.filter((task) => investigationStageKey(task) === stage.key))
        companyStagesByStage.set(stage.key, companyStages.filter((item) => normalisedStageKey(item.stage_key) === stage.key))
    }
    const stageMetrics = {
        seed: poll.seeded_count ?? stageRunsByKey.get("seed")?.passed_count ?? companies.length,
        business_validation: poll.validation_passed_count ?? stageRunsByKey.get("business_validation")?.passed_count ?? 0,
        owner_identity: poll.owner_identity_count ?? stageRunsByKey.get("owner_identity")?.passed_count ?? ownerIdentityClaimCount,
        owner_phone: poll.owner_phone_count ?? stageRunsByKey.get("owner_phone")?.passed_count ?? ownerPhoneClaimCount,
        phone_validation: poll.callable_phone_count ?? stageRunsByKey.get("phone_validation")?.passed_count ?? poll.qualified_count,
    }

    return <main className="min-h-screen bg-neutral-950 px-4 pb-5 text-white sm:px-8 sm:pb-8">
        <PollLiveRefresh enabled={live} />
        <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="leadgen" />
        <div className="mx-auto max-w-6xl pt-5">
            <DetailPageHeader
                category="Poll"
                reference={shortId(poll.id)}
                title={`${sourceNames(poll.source_snapshot, poll.source_count)} poll`}
                subtitle={live ? "Live view refreshes automatically while the poll is active." : undefined}
                labels={<SquarePill>{poll.trigger === "manual" ? "Manual" : "Automated"}</SquarePill>}
                status={<Status label={meta.label} tone={meta.tone} />}
                facts={[{ label: "duration", value: <PollDuration startedAt={poll.started_at} createdAt={poll.created_at} completedAt={poll.completed_at} live={live} /> }]}
                updated={formatRelativeTime(poll.completed_at ?? poll.started_at ?? poll.created_at)}
            />

            <DetailFields>
                <DetailField label="Status" icon="status"><Status label={meta.label} tone={meta.tone} /></DetailField>
                <DetailField label="Trigger" icon="source" className="capitalize lg:border-l lg:border-neutral-900 lg:pl-8">{poll.trigger}</DetailField>
                <DetailField label="Requested by" icon="user"><span className="font-mono">{shortId(poll.requested_by)}</span></DetailField>
                <DetailField label="Created" icon="time" className="lg:border-l lg:border-neutral-900 lg:pl-8">{formatRelativeTime(poll.created_at)}</DetailField>
            </DetailFields>

            <section className="mt-5 grid grid-cols-5 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 md:gap-3 md:overflow-visible md:rounded-none md:border-0 md:bg-transparent">
                {[
                    ["Seeded", stageMetrics.seed],
                    ["Validated", stageMetrics.business_validation],
                    ["Owners", stageMetrics.owner_identity],
                    ["Numbers", stageMetrics.owner_phone],
                    ["Callable", stageMetrics.phone_validation],
                ].map(([label, value]) => <div key={label} className="border-r border-neutral-800 px-1.5 py-2 text-center last:border-r-0 md:rounded-xl md:border md:border-neutral-800 md:bg-neutral-900 md:p-3 md:text-left">
                    <p className="text-[9px] leading-tight text-neutral-500 sm:text-xs">{label}</p>
                    <p className="mt-1 text-base font-semibold sm:text-lg">{value}</p>
                </div>)}
            </section>

            <section className="mt-5 rounded-xl border border-neutral-800 bg-black sm:rounded-2xl">
                <div className="border-b border-neutral-800 px-3.5 py-3 sm:px-5 sm:py-4">
                    <h2 className="font-semibold">Poll funnel</h2>
                    <p className="mt-1 text-sm leading-5 text-neutral-500">Each step runs against the whole current batch before the next step starts.</p>
                    <p className="mt-2 text-xs text-neutral-600">{tasks.length} source tasks · {investigations.length} candidate checks · {claims.length} evidence claims</p>
                </div>
                <div className="divide-y divide-neutral-900">
                    {stageDefinitions.map((stage, index) => {
                        const run = stageRunsByKey.get(stage.key)
                        const sourceTasks = sourceTasksByStage.get(stage.key) ?? []
                        const investigationTasks = investigationTasksByStage.get(stage.key) ?? []
                        const companyRows = companyStagesByStage.get(stage.key) ?? []
                        const runStatus = run?.status ?? (poll.current_stage === stage.key ? "running" : index === 0 && tasks.length ? "completed" : "queued")
                        const runMeta = statusMeta(runStatus === "skipped" ? "queued" : runStatus)
                        const passed = run?.passed_count ?? stageMetrics[stage.key]
                        const input = run?.input_count ?? (stage.key === "seed" ? run?.target_count ?? poll.max_seed_candidates ?? 0 : 0)
                        const failed = run?.failed_count ?? 0
                        const skipped = run?.skipped_count ?? 0
                        const passedRows = companyRows.filter((row) => row.status === "passed")
                        const leadOutcomes = (stage.key === "seed" && passedRows.length === 0
                            ? companies.map((company) => {
                                const score = scoreByCompany.get(company.id)
                                return {
                                    id: `seed-${company.id}`,
                                    companyId: company.id,
                                    status: "seeded",
                                    stageScore: numericScore(company.business_support_points),
                                    totalScore: numericScore(score?.total_score ?? company.lead_score ?? company.business_support_points),
                                    sourceChecks: company.source_key ? 1 : 0,
                                    reason: "Seed candidate collected.",
                                    company,
                                    score,
                                    row: null,
                                }
                            })
                            : passedRows.map((row) => {
                                const company = companyById.get(row.company_id)
                                const score = scoreByCompany.get(row.company_id)
                                return {
                                    id: row.id,
                                    companyId: row.company_id,
                                    status: row.status,
                                    stageScore: numericScore(row.score),
                                    totalScore: numericScore(score?.total_score ?? company?.lead_score ?? row.score),
                                    sourceChecks: countSourceKeys(row.source_keys),
                                    reason: row.reason ?? "Stage passed.",
                                    company,
                                    score,
                                    row,
                                }
                            }))
                            .sort((a, b) => b.totalScore - a.totalScore || b.stageScore - a.stageScore)
                        const visibleLeadOutcomes = leadOutcomes.slice(0, 8)
                        const totalTasks = sourceTasks.length + investigationTasks.length
                        const completedTasks = sourceTasks.filter((task) => task.status === "completed").length + investigationTasks.filter((task) => task.status === "completed").length
                        const failedTasks = sourceTasks.filter((task) => task.status === "failed").length + investigationTasks.filter((task) => task.status === "failed").length
                        const taskCompanyOutput = sourceTasks.reduce((total, task) => total + numericScore(task.company_count), 0)
                        const matchedChecks = investigationTasks.filter((task) => task.matched).length
                        const totalChecks = leadOutcomes.reduce((total, outcome) => total + outcome.sourceChecks, 0)
                        const topScore = leadOutcomes[0]?.totalScore ?? 0
                        return <details key={stage.key} open={runStatus === "running" || runStatus === "failed"} className="group">
                            <summary className="grid cursor-pointer list-none grid-cols-[28px_minmax(0,1fr)_132px_20px] items-center gap-2 px-3 py-3 sm:grid-cols-[34px_minmax(0,1fr)_auto_24px] sm:gap-3 sm:px-5 sm:py-4">
                                <span className={`mt-0.5 flex h-7 w-7 items-center justify-center rounded-lg border text-sm ${runStatus === "completed" ? "border-emerald-400/30 bg-emerald-300/10 text-emerald-200" : runStatus === "running" ? "border-yellow-400/30 bg-yellow-300/10 text-yellow-200" : runStatus === "failed" ? "border-red-400/30 bg-red-300/10 text-red-200" : "border-neutral-800 bg-neutral-950 text-neutral-500"}`}>{index + 1}</span>
                                <div className="min-w-0">
                                    <h3 className="text-sm font-semibold leading-5 text-white">{stage.title}</h3>
                                    <span className={`mt-0.5 inline-flex items-center gap-1.5 text-xs ${runStatus === "skipped" ? "text-neutral-500" : runMeta.text}`}><BetelgezeStatusMark className={runStatus === "skipped" ? "bg-neutral-600" : runMeta.mark} />{runStatus}</span>
                                    <p className="mt-1 hidden text-sm leading-5 text-neutral-500 sm:block">{stage.detail}</p>
                                    <p className="mt-1 truncate text-xs text-neutral-500">{plural(leadOutcomes.length, "lead")} in overview · top score {topScore} · {plural(totalTasks, "task")}</p>
                                    {run?.error ? <p className="mt-2 text-xs leading-5 text-red-200">{run.error}</p> : null}
                                </div>
                                <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[290px] sm:gap-4">
                                    <div>
                                        <p className="text-base font-semibold leading-5 text-white sm:text-lg sm:leading-6">{passed}</p>
                                        <p className="text-[9px] uppercase leading-3 text-neutral-600 sm:text-[11px]">{stage.passedLabel}</p>
                                    </div>
                                    <div>
                                        <p className="text-base font-semibold leading-5 text-neutral-200 sm:text-lg sm:leading-6">{input}</p>
                                        <p className="text-[9px] uppercase leading-3 text-neutral-600 sm:text-[11px]">input</p>
                                    </div>
                                    <div>
                                        <p className="text-[13px] font-semibold leading-5 text-neutral-200 sm:text-lg sm:leading-6">{formatDuration(run?.started_at ?? run?.created_at, run?.completed_at)}</p>
                                        <p className="text-[9px] uppercase leading-3 text-neutral-600 sm:text-[11px]">time</p>
                                    </div>
                                </div>
                                <span className="flex h-8 w-5 items-center justify-center justify-self-end text-lg leading-none text-neutral-500 transition group-open:rotate-90 group-hover:text-neutral-300" aria-hidden="true">›</span>
                            </summary>
                            <div className="min-w-0 border-t border-neutral-900 bg-neutral-950/40 px-3 py-2.5 sm:px-5 sm:py-3">
                                <p className="mb-2 text-xs leading-5 text-neutral-500 sm:hidden">{stage.detail}</p>
                                <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                                    <section className="min-w-0 overflow-hidden rounded-lg border border-neutral-800 bg-black p-3 sm:p-4">
                                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                            <div className="min-w-0">
                                                <h4 className="text-sm font-semibold text-neutral-100">Lead overview</h4>
                                                <p className="mt-1 text-xs leading-5 text-neutral-500">Businesses that passed this step, ranked by total score so far.</p>
                                            </div>
                                            <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 text-center sm:min-w-[260px]">
                                                <div className="border-r border-neutral-800 px-2 py-2">
                                                    <p className="text-sm font-semibold text-neutral-100">{leadOutcomes.length}</p>
                                                    <p className="text-[10px] uppercase text-neutral-600">passed</p>
                                                </div>
                                                <div className="border-r border-neutral-800 px-2 py-2">
                                                    <p className="text-sm font-semibold text-neutral-100">{topScore}</p>
                                                    <p className="text-[10px] uppercase text-neutral-600">top score</p>
                                                </div>
                                                <div className="px-2 py-2">
                                                    <p className="text-sm font-semibold text-neutral-100">{totalChecks}</p>
                                                    <p className="text-[10px] uppercase text-neutral-600">checks</p>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="mt-3 space-y-2">
                                            {visibleLeadOutcomes.map((outcome) => {
                                                const company = outcome.company
                                                const ownerName = company?.owner_name ?? outcome.score?.best_owner_name ?? null
                                                const ownerPhone = company?.owner_phone ?? outcome.score?.best_owner_phone ?? null
                                                return <details key={outcome.id} className="min-w-0 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2">
                                                    <summary className="grid min-w-0 cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-xs sm:grid-cols-[minmax(0,1fr)_80px_90px_minmax(0,1fr)] sm:text-sm">
                                                        <span className="min-w-0 truncate font-medium text-neutral-100">{company?.display_name ?? shortId(outcome.companyId)}</span>
                                                        <span className="text-neutral-300">score {outcome.totalScore}</span>
                                                        <span className="text-neutral-500">{plural(outcome.sourceChecks, "check")}</span>
                                                        <span className="col-span-2 min-w-0 truncate text-neutral-500 sm:col-auto">{ownerName ? `Owner: ${ownerName}` : ownerPhone ? `Owner phone: ${ownerPhone}` : outcome.reason}</span>
                                                    </summary>
                                                    <JsonPreviewBlock value={{ stage_result: outcome.row, company, score: outcome.score }} />
                                                </details>
                                            })}
                                            {leadOutcomes.length > visibleLeadOutcomes.length ? <p className="text-xs text-neutral-500">+{leadOutcomes.length - visibleLeadOutcomes.length} more passed businesses in the full company list below.</p> : null}
                                            {leadOutcomes.length === 0 ? <p className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-500">No businesses have passed this step yet.</p> : null}
                                        </div>
                                    </section>
                                    <section className="min-w-0 overflow-hidden rounded-lg border border-neutral-800 bg-black p-3 sm:p-4">
                                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                            <div className="min-w-0">
                                                <h4 className="text-sm font-semibold text-neutral-100">Tasks</h4>
                                                <p className="mt-1 text-xs leading-5 text-neutral-500">Worker rows and source queries are collapsed until you need them.</p>
                                            </div>
                                            <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 text-center sm:min-w-[260px]">
                                                <div className="border-r border-neutral-800 px-2 py-2">
                                                    <p className="text-sm font-semibold text-neutral-100">{completedTasks}/{totalTasks}</p>
                                                    <p className="text-[10px] uppercase text-neutral-600">done</p>
                                                </div>
                                                <div className="border-r border-neutral-800 px-2 py-2">
                                                    <p className="text-sm font-semibold text-neutral-100">{taskCompanyOutput}</p>
                                                    <p className="text-[10px] uppercase text-neutral-600">outputs</p>
                                                </div>
                                                <div className="px-2 py-2">
                                                    <p className={`text-sm font-semibold ${failedTasks ? "text-red-200" : "text-neutral-100"}`}>{failedTasks}</p>
                                                    <p className="text-[10px] uppercase text-neutral-600">failed</p>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-500 sm:gap-x-4">
                                            <span>{failed} lead failures</span>
                                            <span>{skipped} skipped</span>
                                            <span>{run?.replaced_count ?? 0} replaced or held back</span>
                                            <span>{matchedChecks} matched candidate checks</span>
                                        </div>
                                        <details className="group mt-3">
                                            <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-200">
                                                <span>Task rows</span>
                                                <span className="text-lg leading-none text-neutral-500 transition group-open:rotate-90" aria-hidden="true">›</span>
                                            </summary>
                                            <div className="mt-3 min-w-0 space-y-2">
                                                {sourceTasks.map((task) => {
                                                    const taskMeta = statusMeta(task.status)
                                                    return <details key={task.id} className="min-w-0 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2">
                                                        <summary className="grid min-w-0 cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-xs sm:grid-cols-[130px_minmax(0,1fr)_90px_90px_minmax(0,1fr)] sm:text-sm">
                                                            <span className="min-w-0 truncate text-neutral-200 sm:col-start-2 sm:row-start-1">{sourceHumanLabel(task.source_key, sourcesByKey, sourceLabel)}</span>
                                                            <span className={`inline-flex items-center justify-end gap-1.5 whitespace-nowrap sm:col-start-1 sm:row-start-1 sm:justify-start sm:gap-2 ${taskMeta.text}`}><BetelgezeStatusMark className={taskMeta.mark} />{taskMeta.label}</span>
                                                            <span className="text-neutral-500">{task.raw_count ?? 0} raw</span>
                                                            <span className="hidden text-neutral-500 sm:block">{task.company_count ?? 0} outputs</span>
                                                            <span className="col-span-2 min-w-0 truncate text-neutral-500 sm:hidden">{task.stage ?? "source task"} · {task.company_count ?? 0} outputs</span>
                                                            <span className="hidden min-w-0 truncate text-neutral-500 sm:block">{task.stage ?? "source task"}</span>
                                                        </summary>
                                                        <JsonPreviewBlock value={task.source_query} />
                                                    </details>
                                                })}
                                                {investigationTasks.map((task) => {
                                                    const taskMeta = statusMeta(task.status === "skipped" ? "queued" : task.status)
                                                    return <details key={task.id} className="min-w-0 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2">
                                                        <summary className="grid min-w-0 cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-xs sm:grid-cols-[130px_minmax(0,1fr)_90px_120px_minmax(0,1fr)] sm:text-sm">
                                                            <span className="min-w-0 truncate text-neutral-200 sm:col-start-2 sm:row-start-1">{sourceHumanLabel(task.source_key, sourcesByKey, sourceLabel)}</span>
                                                            <span className={`inline-flex items-center justify-end gap-1.5 whitespace-nowrap sm:col-start-1 sm:row-start-1 sm:justify-start sm:gap-2 ${task.status === "skipped" ? "text-neutral-500" : taskMeta.text}`}><BetelgezeStatusMark className={task.status === "skipped" ? "bg-neutral-600" : taskMeta.mark} />{task.status}</span>
                                                            <span className="text-neutral-500">{task.matched ? "matched" : "no match"}</span>
                                                            <span className="text-neutral-500">{evidenceSignalLabel(task)}</span>
                                                            <span className="col-span-2 min-w-0 truncate text-neutral-500 sm:col-auto">{task.error ?? task.skip_reason ?? "candidate check"}</span>
                                                        </summary>
                                                        <JsonPreviewBlock value={task} />
                                                    </details>
                                                })}
                                                {sourceTasks.length === 0 && investigationTasks.length === 0 ? <p className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-500">No task rows recorded for this stage yet.</p> : null}
                                            </div>
                                        </details>
                                    </section>
                                </div>
                            </div>
                        </details>
                    })}
                </div>
            </section>

            <section className="mt-5 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
                <h2 className="font-semibold">Console</h2>
                {poll.error ? <p className="mt-3 whitespace-pre-wrap break-words text-sm text-red-100">{poll.error}</p> : null}
                <div className="mt-3 space-y-2">
                    {consoleRows.length ? consoleRows.map((row) => <p key={row.id} className="whitespace-pre-wrap break-words rounded-lg border border-red-400/20 bg-black/30 p-3 text-xs text-red-100">{row.label}: {row.error}</p>) : <p className="rounded-lg border border-neutral-800 bg-black px-3 py-2 text-sm text-neutral-500">No poll errors logged.</p>}
                </div>
            </section>

            <section className="mt-5 rounded-2xl border border-neutral-800 bg-black">
                <div className="border-b border-neutral-800 px-5 py-4">
                    <h2 className="font-semibold">Companies returned</h2>
                    <p className="mt-1 text-sm text-neutral-500">Normalised companies from this poll, including owner and phone fields.</p>
                </div>
                {companies.length ? companies.map((company) => <details key={company.id} className="min-w-0 overflow-hidden border-b border-neutral-900 px-4 py-3 last:border-0">
                    <summary className="grid min-w-0 cursor-pointer gap-3 md:grid-cols-[minmax(180px,1fr)_170px_170px_130px_120px] md:items-center">
                        <span className="min-w-0 truncate text-sm font-medium text-neutral-100">{company.display_name}</span>
                        <span className="min-w-0 truncate text-sm text-neutral-300">{company.owner_name ? `Owner: ${company.owner_name}` : "No owner"}</span>
                        <span className="min-w-0 truncate text-sm text-neutral-300">{company.owner_phone ?? "No owner phone"}</span>
                        <span className="min-w-0 truncate text-sm text-neutral-500">{scoreByCompany.get(company.id)?.qualification_status ?? company.qualification_status} · score {scoreByCompany.get(company.id)?.total_score ?? company.lead_score ?? 0}</span>
                        <span className="font-mono text-xs text-neutral-500">{shortId(company.id)}</span>
                    </summary>
                    <JsonPreviewBlock value={company} maxHeight="max-h-80" tone="neutral" />
                </details>) : <p className="p-5 text-sm text-neutral-500">No companies were normalised.</p>}
            </section>

            <section className="mt-5 grid gap-5 lg:grid-cols-2">
                <div className="min-w-0 overflow-hidden rounded-2xl border border-neutral-800 bg-black">
                    <div className="border-b border-neutral-800 px-5 py-4">
                        <h2 className="font-semibold">Raw source records</h2>
                    </div>
                    {records.length ? records.map((record) => <details key={record.id} className="min-w-0 overflow-hidden border-b border-neutral-900 px-4 py-3 last:border-0">
                        <summary className="min-w-0 cursor-pointer truncate text-sm text-neutral-200">{record.company_name} <span className="ml-2 text-neutral-500">{record.phone ?? "no phone"}</span></summary>
                        <JsonPreviewBlock value={record} tone="neutral" />
                    </details>) : <p className="p-5 text-sm text-neutral-500">No raw source records stored.</p>}
                </div>
                <div className="min-w-0 overflow-hidden rounded-2xl border border-neutral-800 bg-black">
                    <div className="border-b border-neutral-800 px-5 py-4">
                        <h2 className="font-semibold">Evidence claims</h2>
                    </div>
                    {claims.length ? claims.map((item) => <details key={item.id} className="min-w-0 overflow-hidden border-b border-neutral-900 px-4 py-3 last:border-0">
                        <summary className="min-w-0 cursor-pointer truncate text-sm text-neutral-200">{item.claim_kind} <span className="ml-2 text-neutral-500">{sourceHumanLabel(item.source_key, sourcesByKey, sourceLabel)} · weight {item.points_awarded} · {item.confidence ?? "—"}%</span></summary>
                        <JsonPreviewBlock value={item} tone="neutral" />
                    </details>) : evidence.length ? evidence.map((item) => <details key={item.id} className="min-w-0 overflow-hidden border-b border-neutral-900 px-4 py-3 last:border-0">
                        <summary className="min-w-0 cursor-pointer truncate text-sm text-neutral-200">{item.evidence_kind} <span className="ml-2 text-neutral-500">{sourceHumanLabel(item.source_key, sourcesByKey, sourceLabel)} · {item.confidence ?? "—"}%</span></summary>
                        <JsonPreviewBlock value={item} tone="neutral" />
                    </details>) : <p className="p-5 text-sm text-neutral-500">No source evidence stored.</p>}
                </div>
            </section>

            <DetailDangerZone>
                <DetailDangerAction title="Archive poll" description="Archive will remove this poll from active lists while preserving its results, evidence, and diagnostic history." control={<DetailDangerButton type="button" disabled>Archive poll</DetailDangerButton>} />
                <DetailDangerAction title="Delete poll permanently" description="Permanent deletion will be enabled after archive storage and generated-lead retention safeguards are implemented." control={<DetailDangerButton type="button" tone="delete" disabled>Delete permanently</DetailDangerButton>} />
            </DetailDangerZone>
        </div>
    </main>
}
