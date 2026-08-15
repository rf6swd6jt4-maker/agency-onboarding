import { BetelgezeStatusMark } from "@/components/brand/BetelgezeStatusMark"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { WorkspaceActionButton } from "@/components/workspace/WorkspaceActionButton"
import { leadgenSourceFamilyLabels, sourceHealthMap, sourceMetadataNote, sourceStatusMeta, type LeadgenSourceCatalogRow, type LeadgenSourceHealthRow } from "@/lib/leadgen/source-catalog-ui"
import { buildSourcePlan, executableLeadgenSources, leadgenSourceOptions, leadgenSourceRuntimeConfigured, seedLeadgenSources, type LeadgenSourceConfig, type LeadgenSourceKey } from "@/lib/leadgen/sources"
import { LEADGEN_POLLING_SYSTEM_VERSION_LABEL } from "@/lib/leadgen/version"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"
import { createLeadgenPoll } from "../actions"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ workspaceSlug: string }> }
type SourceMapping = { source_key: LeadgenSourceKey; icp_industry_value?: string | null; icp_location_value?: string | null; native_values?: string[] | null }

function configObject(value: unknown): Partial<LeadgenSourceConfig> {
    return value && typeof value === "object" ? value as Partial<LeadgenSourceConfig> : {}
}

function sourceRequirement(sourceKey: LeadgenSourceKey, hasSeedSource: boolean) {
    if (sourceKey === "website" && !hasSeedSource) return "Needs a seed source first"
    return null
}

export default async function NewLeadgenPollPage({ params }: PageProps) {
    const { workspaceSlug } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    const settingsResult = await supabaseAdmin
        .from("leadgen_workspace_settings")
        .select("enabled_sources, source_config")
        .eq("workspace_id", workspace.id)
        .maybeSingle()
    const settings = settingsResult.error ? null : settingsResult.data
    const enabledSources = Array.isArray(settings?.enabled_sources) ? settings.enabled_sources.map(String) : []
    const sourceConfig = configObject(settings?.source_config)
    const rawSelectedIndustries = sourceConfig.icp?.industries ?? []
    const rawSelectedLocations = sourceConfig.icp?.locations ?? []
    const [industriesResult, locationsResult, industryMappingsResult, locationMappingsResult, catalogResult, healthResult] = await Promise.all([
        supabaseAdmin.from("leadgen_icp_industries").select("value, label").eq("enabled", true).in("value", rawSelectedIndustries.length ? rawSelectedIndustries : ["__none__"]).order("label", { ascending: true }),
        supabaseAdmin.from("leadgen_icp_locations").select("value, label").eq("enabled", true).in("value", rawSelectedLocations.length ? rawSelectedLocations : ["__none__"]).order("label", { ascending: true }),
        supabaseAdmin.from("leadgen_source_industry_mappings").select("source_key, icp_industry_value, native_values").eq("enabled", true),
        supabaseAdmin.from("leadgen_source_location_mappings").select("source_key, icp_location_value, native_values").eq("enabled", true),
        supabaseAdmin
            .from("leadgen_source_catalog")
            .select("source_key, label, family, source_points, owner_identity_points, owner_phone_points, business_support_points, access_method, free_status, implementation_status, run_stage, enabled, rate_limit_ms, coverage, metadata")
            .order("family", { ascending: true })
            .order("label", { ascending: true }),
        supabaseAdmin
            .from("leadgen_source_health")
            .select("source_key, status, last_success_at, last_failure_at, last_error, metadata"),
    ])
    const industryLabels = new Map((industriesResult.data ?? []).map((industry) => [industry.value, industry.label]))
    const locationLabels = new Map((locationsResult.data ?? []).map((location) => [location.value, location.label]))
    const selectedIndustries = rawSelectedIndustries.filter((value) => industryLabels.has(value))
    const selectedLocations = rawSelectedLocations.filter((value) => locationLabels.has(value))
    const unsupportedIndustries = rawSelectedIndustries.filter((value) => !industryLabels.has(value))
    const unsupportedLocations = rawSelectedLocations.filter((value) => !locationLabels.has(value))
    const runnableSourceConfig = {
        ...sourceConfig,
        icp: {
            ...sourceConfig.icp,
            industries: selectedIndustries,
            locations: selectedLocations,
        },
    } satisfies Partial<LeadgenSourceConfig>
    const sourcePlan = buildSourcePlan(enabledSources, runnableSourceConfig)
    const industryMappings = (industryMappingsResult.error ? [] : industryMappingsResult.data ?? []) as SourceMapping[]
    const locationMappings = (locationMappingsResult.error ? [] : locationMappingsResult.data ?? []) as SourceMapping[]
    const catalog = (catalogResult.error ? [] : catalogResult.data ?? []) as LeadgenSourceCatalogRow[]
    const sourceHealth = sourceHealthMap((healthResult.error ? [] : healthResult.data ?? []) as LeadgenSourceHealthRow[])
    const hasSeedSource = sourcePlan.some((plan) => seedLeadgenSources.has(plan.key))
    const sourceSummaries = leadgenSourceOptions.map((source) => {
        const plan = sourcePlan.find((item) => item.key === source.value)
        const mappedIndustries = new Set(industryMappings.filter((mapping) => mapping.source_key === source.value && (mapping.native_values?.length ?? 0) > 0).map((mapping) => mapping.icp_industry_value).filter(Boolean))
        const mappedLocations = new Set(locationMappings.filter((mapping) => mapping.source_key === source.value && (mapping.native_values?.length ?? 0) > 0).map((mapping) => mapping.icp_location_value).filter(Boolean))
        const coveredIndustries = selectedIndustries.filter((value) => mappedIndustries.has(value)).length
        const coveredLocations = selectedLocations.filter((value) => mappedLocations.has(value)).length
        const requirement = sourceRequirement(source.value, hasSeedSource)
        const enabled = Boolean(plan)
        const mapped = selectedIndustries.length > 0 && selectedLocations.length > 0 && coveredIndustries > 0 && coveredLocations > 0
        const configured = leadgenSourceRuntimeConfigured(source.value)
        const ready = enabled && executableLeadgenSources.has(source.value) && configured && mapped && !requirement
        return { source, enabled, ready, requirement, configured, coveredIndustries, coveredLocations, mapped }
    })
    const enabledSummaries = sourceSummaries.filter((summary) => summary.enabled)
    const readySources = sourceSummaries.filter((summary) => summary.ready)
    const readySeedSources = sourceSummaries.filter((summary) => summary.ready && seedLeadgenSources.has(summary.source.value))
    const readyPollTimeSources = readySources.filter((summary) => !seedLeadgenSources.has(summary.source.value))
    const blockedEnabledSources = enabledSummaries.filter((summary) => !summary.ready)
    const notConfiguredEnabled = blockedEnabledSources.filter((summary) => !summary.configured)
    const notMappedEnabled = blockedEnabledSources.filter((summary) => summary.configured && !summary.mapped)
    const blockingProblems = [
        selectedIndustries.length === 0 ? "No supported industries are selected." : null,
        selectedLocations.length === 0 ? "No supported locations are selected." : null,
        readySeedSources.length === 0 ? "No ready seed source can create candidate businesses for this target." : null,
    ].filter((item): item is string => Boolean(item))
    const warnings = [
        unsupportedIndustries.length ? `${unsupportedIndustries.length} saved industry ${unsupportedIndustries.length === 1 ? "selection is" : "selections are"} no longer supported.` : null,
        unsupportedLocations.length ? `${unsupportedLocations.length} saved location ${unsupportedLocations.length === 1 ? "selection is" : "selections are"} outside the v1 pilot set.` : null,
        notConfiguredEnabled.length ? `${notConfiguredEnabled.length} enabled source${notConfiguredEnabled.length === 1 ? "" : "s"} still need runtime configuration.` : null,
        notMappedEnabled.length ? `${notMappedEnabled.length} enabled source${notMappedEnabled.length === 1 ? "" : "s"} do not map to the selected targets.` : null,
    ].filter((item): item is string => Boolean(item))
    const canRun = blockingProblems.length === 0
    const preflightStatus = canRun ? warnings.length ? "Can run with warnings" : "Ready to run" : "Needs attention"
    const preflightMark = canRun ? warnings.length ? "bg-amber-300" : "bg-emerald-300" : "bg-red-300"
    const preflightText = canRun ? warnings.length ? "text-amber-200" : "text-emerald-200" : "text-red-200"

    return <main className="min-h-screen bg-neutral-950 px-4 pb-5 text-white sm:px-8 sm:pb-8">
        <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="leadgen" />
        <div className="mx-auto max-w-5xl pt-5">
            <section className="py-6 sm:py-10">
                <p className="font-mono text-xs text-neutral-500">Lead Gen {LEADGEN_POLLING_SYSTEM_VERSION_LABEL}</p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Confirm owner-first candidate investigation</h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-400">This poll will seed new businesses from the current ICP, then run the staged v5.5.0 owner-identity system. Florida targets keep using Sunbiz external shards plus county records; Arizona targets now use ACC entity and Secretary of State trade-name external owner shards before guarded websites or weaker fallbacks.</p>
            </section>

            <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 sm:p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                        <div className={`inline-flex items-center gap-2 text-sm ${preflightText}`}><BetelgezeStatusMark className={preflightMark} />{preflightStatus}</div>
                        <h2 className="mt-2 text-lg font-semibold">Poll preflight</h2>
                        <p className="mt-1 max-w-2xl text-sm leading-5 text-neutral-500">Checks the selected target, enabled sources, source mappings, runtime configuration, and whether the owner-identity stage has enough real pollable sources before creating work.</p>
                    </div>
                    <form action={createLeadgenPoll.bind(null, workspace.slug)} data-workspace-mutation="background" className="flex w-full flex-col gap-2 md:w-auto md:min-w-[220px]">
                        <WorkspaceActionButton disabled={!canRun} pendingLabel="Starting poll…" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400">Start poll</WorkspaceActionButton>
                        <p className="text-xs leading-5 text-neutral-500">{canRun ? `${readySeedSources.length} seed source${readySeedSources.length === 1 ? "" : "s"} ready; ${readySources.length} total source${readySources.length === 1 ? "" : "s"} ready.` : blockingProblems[0]}</p>
                    </form>
                </div>

                <div className="mt-5 grid grid-cols-2 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 md:grid-cols-4">
                    {[
                        ["Targets", `${selectedIndustries.length}×${selectedLocations.length}`],
                        ["Enabled", enabledSummaries.length],
                        ["Ready seeds", readySeedSources.length],
                        ["Ready enrichment", readyPollTimeSources.length],
                    ].map(([label, value], index) => <div key={String(label)} className={`px-3 py-3 ${index % 2 === 0 ? "border-r" : ""} border-neutral-800 md:border-r md:last:border-r-0`}>
                        <p className="text-xs text-neutral-500">{label}</p>
                        <p className="mt-1 text-lg font-semibold text-neutral-100">{value}</p>
                    </div>)}
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-3">
                    {[
                        ["Owner identities first", "The poll prioritises real owner/principal names before phone discovery, so phone steps are not starved by weak identity evidence."],
                        ["Florida strengthened", "Sunbiz shards, Miami-Dade/Hillsborough property appraisers, and Hillsborough clerk records can now contribute to Florida evidence."],
                        ["Cautious public records", "Property and clerk rows are matched strictly; clerk filings mainly score/corroborate and do not turn unrelated filing parties into owners."],
                    ].map(([title, copy]) => <div key={title} className="rounded-lg border border-neutral-800 bg-black px-3 py-3">
                        <p className="text-sm font-medium text-neutral-100">{title}</p>
                        <p className="mt-1 text-xs leading-5 text-neutral-500">{copy}</p>
                    </div>)}
                </div>

                <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_0.9fr]">
                    <div>
                        <h3 className="text-sm font-semibold text-neutral-100">Targets</h3>
                        <div className="mt-3 grid gap-4 sm:grid-cols-2">
                            <div>
                                <p className="text-sm text-neutral-400">Industries</p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {selectedIndustries.length ? selectedIndustries.map((value) => <span key={value} className="rounded-full bg-black px-3 py-1 text-xs text-neutral-200">{industryLabels.get(value) ?? value.replace(/_/g, " ")}</span>) : <span className="text-sm text-amber-200">No supported industries selected</span>}
                                </div>
                            </div>
                            <div>
                                <p className="text-sm text-neutral-400">Locations</p>
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {selectedLocations.length ? selectedLocations.map((value) => <span key={value} className="rounded-full bg-black px-3 py-1 text-xs text-neutral-200">{locationLabels.get(value) ?? value.replace(/_/g, " ")}</span>) : <span className="text-sm text-amber-200">No supported locations selected</span>}
                                </div>
                            </div>
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-2 sm:max-w-md">
                            <div className="rounded-lg border border-neutral-800 bg-black px-3 py-2">
                                <p className="text-xs text-neutral-500">Candidate cap</p>
                                <p className="mt-1 text-base font-semibold">{sourceConfig.icp?.limit ?? 1000}</p>
                            </div>
                            <div className="rounded-lg border border-neutral-800 bg-black px-3 py-2">
                                <p className="text-xs text-neutral-500">Owner required</p>
                                <p className="mt-1 text-base font-semibold">{sourceConfig.icp?.ownerRequired === false ? "No" : "Yes"}</p>
                            </div>
                        </div>
                    </div>

                    <div>
                        <h3 className="text-sm font-semibold text-neutral-100">Immediate problems</h3>
                        <div className="mt-3 space-y-2">
                            {[...blockingProblems, ...warnings].length ? [...blockingProblems, ...warnings].slice(0, 6).map((problem) => <p key={problem} className={`rounded-lg border px-3 py-2 text-sm leading-5 ${blockingProblems.includes(problem) ? "border-red-400/20 bg-red-950/20 text-red-100" : "border-amber-400/20 bg-amber-950/20 text-amber-100"}`}>{problem}</p>) : <p className="rounded-lg border border-emerald-400/20 bg-emerald-950/20 px-3 py-2 text-sm text-emerald-100">No immediate blockers found for the selected poll.</p>}
                            {[...blockingProblems, ...warnings].length > 6 ? <p className="text-xs text-neutral-500">+{[...blockingProblems, ...warnings].length - 6} more issues in source readiness below.</p> : null}
                        </div>
                    </div>
                </div>

                <details className="group mt-5 rounded-lg border border-neutral-800 bg-black">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 text-sm font-medium text-neutral-100 sm:px-4">
                        <span>Enabled source readiness</span>
                        <span className="text-xs text-neutral-500">{readySources.length}/{enabledSummaries.length} ready</span>
                    </summary>
                    <div className="divide-y divide-neutral-800 border-t border-neutral-800">
                        {enabledSummaries.length ? enabledSummaries.map(({ source, ready, requirement, configured, coveredIndustries, coveredLocations, mapped }) => {
                            const statusText = ready ? "Ready" : !configured ? "Not configured" : requirement ? requirement : mapped ? "Mapped, waiting" : "Not mapped"
                            const markClass = ready ? "bg-emerald-300" : !configured ? "bg-red-300" : "bg-amber-300"
                            const textClass = ready ? "text-emerald-200" : !configured ? "text-red-200" : "text-amber-200"
                            return <div key={source.value} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2 md:grid-cols-[minmax(160px,1fr)_170px_150px] md:px-4 md:py-3">
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-neutral-100">{source.label}</p>
                                    <p className="mt-1 truncate text-xs text-neutral-500">{source.detail}</p>
                                </div>
                                <span className={`inline-flex items-center justify-end gap-1.5 whitespace-nowrap text-xs md:gap-2 md:text-sm ${textClass}`}><BetelgezeStatusMark className={markClass} />{statusText}</span>
                                <p className="col-span-2 text-xs text-neutral-500 md:col-auto"><span className="text-neutral-200">{coveredIndustries}/{selectedIndustries.length}</span> industries · <span className="text-neutral-200">{coveredLocations}/{selectedLocations.length}</span> locations</p>
                            </div>
                        }) : <p className="px-4 py-3 text-sm text-neutral-500">No sources are enabled. Open Settings and enable at least one seed source.</p>}
                    </div>
                </details>

                <details className="group mt-3 rounded-lg border border-neutral-800 bg-black">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 text-sm font-medium text-neutral-100 sm:px-4">
                        <span>Source catalogue snapshot</span>
                        <span className="text-xs text-neutral-500">{catalog.length} catalogued</span>
                    </summary>
                    <div className="divide-y divide-neutral-800 border-t border-neutral-800">
                        {catalog.length ? catalog.filter((source) => ["active", "validation_only"].includes(source.implementation_status ?? "") || ["bulk_refresh", "source_specific_configuration"].includes(source.run_stage ?? "")).slice(0, 16).map((source) => {
                            const health = sourceHealth.get(source.source_key)
                            const meta = sourceStatusMeta(source, health)
                            return <div key={source.source_key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2 md:grid-cols-[minmax(160px,1fr)_150px_minmax(0,1fr)] md:px-4 md:py-3">
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-neutral-100">{source.label}</p>
                                    <p className="mt-1 truncate text-xs text-neutral-500">{leadgenSourceFamilyLabels[source.family] ?? source.family}</p>
                                </div>
                                <span className={`inline-flex items-center justify-end gap-1.5 whitespace-nowrap text-xs md:gap-2 md:text-sm ${meta.text}`}><BetelgezeStatusMark className={meta.mark} />{meta.label}</span>
                                <p className="col-span-2 truncate text-xs text-neutral-500 md:col-auto">{sourceMetadataNote(source, health)}</p>
                            </div>
                        }) : <p className="px-4 py-3 text-sm text-neutral-500">No source catalogue found. Apply the source fan-out migrations before creating polls.</p>}
                    </div>
                </details>
            </section>
        </div>
    </main>
}
