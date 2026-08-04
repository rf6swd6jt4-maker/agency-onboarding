import { supabaseAdmin } from "@/lib/supabase/admin"
import { platformFailureFingerprint, reportPlatformFailure } from "@/lib/admin/maintenance"
import { recordAdminActivity } from "@/lib/admin/activity"
import type { LeadgenSourcePlanItem } from "@/lib/leadgen/sources"
import { recordEvidenceClaim } from "@/lib/leadgen/evidence-scoring"
import { seedIndustryMappingsWithFallbacks, seedLocationMappingsWithFallbacks } from "@/lib/leadgen/seed-source-fallbacks"

type GeoTarget = {
    value: string
    label: string
    latitude: number | null
    longitude: number | null
    radius_meters: number | null
}

type CategoryMapping = {
    icp_industry_value: string
    native_values: string[] | null
    metadata: Record<string, unknown> | null
}

type LocationMapping = {
    icp_location_value: string
    native_values: string[] | null
}

type OsmElement = {
    type: string
    id: number
    lat?: number
    lon?: number
    center?: { lat?: number; lon?: number }
    tags?: Record<string, string>
}

const OVERPASS_ENDPOINTS = [
    "https://overpass.osm.ch/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]
const OVERPASS_REQUEST_DELAY_MS = 3000
const OVERPASS_FETCH_TIMEOUT_MS = 18000
const OVERPASS_MAX_ATTEMPTS = 2

class OverpassTemporarilyUnavailableError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "OverpassTemporarilyUnavailableError"
    }
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalisePhone(value: string | null | undefined) {
    const digits = value?.replace(/[^\d+]/g, "") ?? ""
    return digits || null
}

function domainFromUrl(value: string | null | undefined) {
    if (!value) return null
    try {
        return new URL(value.startsWith("http") ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, "") || null
    } catch {
        return null
    }
}

function tagClauses(tags: string[], target: GeoTarget, radius: number) {
    return tags
        .map((tag) => {
            const [key, rawValue] = tag.split("=", 2)
            if (!key || !rawValue) return null
            const value = rawValue.replace(/"/g, '\\"')
            const escapedKey = key.replace(/"/g, '\\"')
            return `nwr["${escapedKey}"="${value}"](around:${radius},${target.latitude},${target.longitude});`
        })
        .filter(Boolean)
        .join("\n")
}

function buildOverpassQuery(target: GeoTarget, mapping: CategoryMapping, radius: number, limit: number) {
    const tagsFromMetadata = Array.isArray(mapping.metadata?.osm_tags) ? mapping.metadata.osm_tags.map(String) : []
    const tags = (tagsFromMetadata.length ? tagsFromMetadata : Array.isArray(mapping.native_values) ? mapping.native_values : []).filter(Boolean)
    const clauses = tagClauses(tags, target, radius)
    return `[out:json][timeout:25];
(
${clauses}
);
out center ${limit};`
}

export async function setLeadgenPollStatus(pollId: string, workspaceId: string, status: string, error?: string | null, reportMaintenance = false) {
    const { error: updateError } = await supabaseAdmin
        .from("leadgen_polls")
        .update({ status, error: error ?? null, ...(["completed", "failed", "cancelled"].includes(status) ? { completed_at: new Date().toISOString() } : {}) })
        .eq("id", pollId)
        .eq("workspace_id", workspaceId)
    const { data: workspace } = await supabaseAdmin.from("workspaces").select("slug").eq("id", workspaceId).maybeSingle()
    const sourceHref = workspace?.slug ? `/${workspace.slug}/leadgen/poll/${pollId}` : null
    if (updateError) {
        await reportPlatformFailure({
            workspaceId,
            category: "leadgen",
            source: "leadgen",
            operation: "update_poll_status",
            fingerprint: platformFailureFingerprint(["leadgen", "update_poll_status", updateError.message]),
            severity: "warning",
            summary: "Lead Gen could not persist a poll status",
            diagnostics: { poll_id: pollId, intended_status: status, error: updateError.message },
            sourceHref,
        })
        return
    }
    if (status === "failed" && error && reportMaintenance) {
        await reportPlatformFailure({
            workspaceId,
            category: "leadgen",
            source: "leadgen",
            operation: "poll_processing",
            fingerprint: platformFailureFingerprint(["leadgen", "poll_processing", error]),
            severity: "warning",
            summary: "Lead Gen poll could not progress",
            diagnostics: { poll_id: pollId, error },
            sourceHref,
        })
        return
    }
    await recordAdminActivity({ workspaceId, category: "leadgen", level: status === "failed" || status === "cancelled" ? "warning" : "info", eventKey: `leadgen.poll.${status}`, summary: `Lead Gen poll ${status}`, entityType: "leadgen_poll", entityId: pollId, sourceHref, metadata: { status, detail: error ?? null } })
}

export async function refreshLeadgenPollCounts(pollId: string, workspaceId: string) {
    const [recordsResult, companiesResult, evidenceClaimsResult, investigationResult] = await Promise.all([
        supabaseAdmin.from("leadgen_source_records").select("id", { count: "exact", head: true }).eq("poll_id", pollId),
        supabaseAdmin.from("leadgen_companies").select("id", { count: "exact", head: true }).eq("first_seen_poll_id", pollId),
        supabaseAdmin.from("leadgen_evidence_claims").select("id", { count: "exact", head: true }).eq("poll_id", pollId),
        supabaseAdmin.from("leadgen_investigation_tasks").select("id", { count: "exact", head: true }).eq("poll_id", pollId).in("status", ["completed", "failed", "skipped"]),
    ])
    const qualifiedResult = await supabaseAdmin
        .from("leadgen_companies")
        .select("id", { count: "exact", head: true })
        .eq("first_seen_poll_id", pollId)
        .eq("qualification_status", "qualified")
    await supabaseAdmin
        .from("leadgen_polls")
        .update({
            candidate_count: recordsResult.count ?? 0,
            normalised_count: companiesResult.count ?? 0,
            deduped_count: companiesResult.count ?? 0,
            enriched_count: Math.max(evidenceClaimsResult.count ?? 0, investigationResult.count ?? 0),
            qualified_count: qualifiedResult.count ?? 0,
        })
        .eq("id", pollId)
        .eq("workspace_id", workspaceId)
}

export async function finalizeLeadgenPoll(pollId: string, workspaceId: string) {
    await refreshLeadgenPollCounts(pollId, workspaceId)
    const [tasksResult, companiesResult, stageRunsResult] = await Promise.all([
        supabaseAdmin
            .from("leadgen_poll_tasks")
            .select("source_key, industry_value, location_value, status, error")
            .eq("poll_id", pollId)
            .eq("workspace_id", workspaceId)
            .order("created_at", { ascending: true }),
        supabaseAdmin
            .from("leadgen_companies")
            .select("id", { count: "exact", head: true })
            .eq("first_seen_poll_id", pollId)
            .eq("qualification_status", "qualified"),
        supabaseAdmin
            .from("leadgen_poll_stage_runs")
            .select("stage_key, passed_count, status")
            .eq("poll_id", pollId)
            .eq("workspace_id", workspaceId),
    ])
    if (tasksResult.error) {
        await setLeadgenPollStatus(pollId, workspaceId, "failed", `Could not read poll task results: ${tasksResult.error.message}`, true)
        return
    }
    const tasks = tasksResult.data ?? []
    const stageRuns = stageRunsResult.error ? [] : stageRunsResult.data ?? []
    const stagedPoll = stageRuns.length > 0
    const ownerPhoneStage = stageRuns.find((stage) => stage.stage_key === "owner_phone")
    const phoneValidationStage = stageRuns.find((stage) => stage.stage_key === "phone_validation")
    const failedTasks = tasks.filter((task) => task.status === "failed")
    const unfinishedTasks = tasks.filter((task) => ["queued", "running"].includes(task.status))
    const qualifiedCompanyCount = companiesResult.count ?? 0
    const totalTaskCount = tasks.length
    const failedOrUnfinishedCount = failedTasks.length + unfinishedTasks.length
    const majorityTasksFailed = totalTaskCount === 0 || failedOrUnfinishedCount > totalTaskCount / 2
    const firstErrors = failedTasks
        .slice(0, 3)
        .map((task) => `${task.source_key}/${task.industry_value ?? "unknown"}/${task.location_value ?? "unknown"}: ${task.error || "Unknown source error"}`)
        .join(" | ")
    const noStagedOwnerPhones = stagedPoll && (ownerPhoneStage?.passed_count ?? 0) === 0
    const noStagedCallablePhones = stagedPoll && (phoneValidationStage?.passed_count ?? 0) === 0
    const noQualifiedLeads = qualifiedCompanyCount === 0
    const shouldFail = majorityTasksFailed || (stagedPoll ? noStagedOwnerPhones || noStagedCallablePhones || noQualifiedLeads : noQualifiedLeads)
    const warning = failedTasks.length > 0
        ? `${failedTasks.length} source task${failedTasks.length === 1 ? "" : "s"} failed.${firstErrors ? ` ${firstErrors}` : ""}`
        : unfinishedTasks.length > 0
            ? `${unfinishedTasks.length} source task${unfinishedTasks.length === 1 ? " was" : "s were"} not processed. Retry the poll or check the enabled sources.`
            : null
    await setLeadgenPollStatus(
        pollId,
        workspaceId,
        shouldFail ? "failed" : "completed",
        shouldFail
            ? majorityTasksFailed
                ? warning ?? "The poll failed because most source tasks did not complete."
                : noStagedOwnerPhones
                    ? "The staged poll found no source-backed owner phone numbers. Betelgeze stored raw candidates and evidence internally, but a poll is only successful when at least one owner number reaches validation."
                    : noStagedCallablePhones
                        ? "The staged poll found owner phone evidence, but no owner phone numbers passed callable-format validation."
                        : "The poll completed, but no qualified leads had both an owner/principal and a callable phone number. Betelgeze stored any raw candidates/evidence internally, but the Leads tab only shows qualified leads."
            : warning,
        majorityTasksFailed && Boolean(warning),
    )
    await refreshLeadgenPollCounts(pollId, workspaceId)
}

function compactErrorMessage(error: unknown) {
    const message = error instanceof Error ? error.message : "OSM task failed."
    return message.length > 900 ? `${message.slice(0, 900)}…` : message
}

function publicOverpassUnavailableMessage(error: unknown) {
    const detail = error instanceof Error ? error.message : "OpenStreetMap/Overpass is temporarily unavailable."
    return `OpenStreetMap/Overpass could not serve this request right now. This can happen because Betelgeze is currently using the free public Overpass service, which rate-limits shared traffic and is not guaranteed to be available on every poll. Try again later or add more lead sources so polling is not dependent on OSM alone. Technical detail: ${detail}`
}

function overpassErrorMessage(status: number, body: string) {
    const cleaned = body
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    const detail = cleaned ? ` ${cleaned.slice(0, 420)}${cleaned.length > 420 ? "…" : ""}` : ""
    return `Overpass returned HTTP ${status}.${detail}`
}

function isTransientOverpassStatus(status: number) {
    return [408, 409, 425, 429, 500, 502, 503, 504].includes(status)
}

function isTransientOverpassError(error: unknown) {
    return error instanceof OverpassTemporarilyUnavailableError
}

async function fetchOverpassFromEndpoint(endpoint: string, query: string) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), OVERPASS_FETCH_TIMEOUT_MS)
    try {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Content-Type": "text/plain; charset=UTF-8",
                "User-Agent": "BetelgezeLeadgen/1.0 (contact: hello@betelgeze.com)",
            },
            body: query,
            cache: "no-store",
            signal: controller.signal,
        })
        const responseText = await response.text()
        if (!response.ok) {
            const message = `${endpoint}: ${overpassErrorMessage(response.status, responseText)}`
            if (isTransientOverpassStatus(response.status)) throw new OverpassTemporarilyUnavailableError(message)
            throw new Error(message)
        }
        return JSON.parse(responseText) as { elements?: OsmElement[] }
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
            throw new OverpassTemporarilyUnavailableError(`${endpoint}: Overpass timed out after ${Math.round(OVERPASS_FETCH_TIMEOUT_MS / 1000)} seconds.`)
        }
        throw error
    } finally {
        clearTimeout(timeout)
    }
}

async function fetchOverpass(query: string) {
    let lastTransientError: Error | null = null
    for (let attempt = 1; attempt <= OVERPASS_MAX_ATTEMPTS; attempt += 1) {
        for (const endpoint of OVERPASS_ENDPOINTS) {
            try {
                return await fetchOverpassFromEndpoint(endpoint, query)
            } catch (error) {
                if (!isTransientOverpassError(error)) throw error
                lastTransientError = error
            }
        }
        if (attempt < OVERPASS_MAX_ATTEMPTS) await sleep(OVERPASS_REQUEST_DELAY_MS * attempt)
    }
    throw new OverpassTemporarilyUnavailableError(lastTransientError?.message ?? "Overpass is temporarily unavailable.")
}

async function upsertOsmElement({ workspaceId, pollId, taskId, industryValue, locationValue, element }: { workspaceId: string; pollId: string; taskId: string; industryValue: string; locationValue: string; element: OsmElement }) {
    const tags = element.tags ?? {}
    const companyName = tags.name?.trim()
    if (!companyName) return false
    const sourceRecordId = `${element.type}/${element.id}`
    const { data: existingRecord, error: existingError } = await supabaseAdmin
        .from("leadgen_source_records")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("source_key", "osm")
        .eq("source_record_id", sourceRecordId)
        .maybeSingle()
    if (existingError) throw existingError
    if (existingRecord) return false
    const phone = normalisePhone(tags.phone || tags["contact:phone"])
    const websiteUrl = tags.website || tags["contact:website"] || null
    const profileUrl = `https://www.openstreetmap.org/${element.type}/${element.id}`
    const latitude = typeof element.lat === "number" ? element.lat : typeof element.center?.lat === "number" ? element.center.lat : null
    const longitude = typeof element.lon === "number" ? element.lon : typeof element.center?.lon === "number" ? element.center.lon : null
    const address = {
        street: [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ") || null,
        city: tags["addr:city"] || null,
        state: tags["addr:state"] || null,
        postcode: tags["addr:postcode"] || null,
        country: tags["addr:country"] || null,
    }
    const categories = Object.entries(tags)
        .filter(([key]) => ["craft", "shop", "office", "amenity", "building"].includes(key))
        .map(([key, value]) => ({ key, value }))
    const sourceRecord = {
        workspace_id: workspaceId,
        poll_id: pollId,
        task_id: taskId,
        source_key: "osm",
        source_record_id: sourceRecordId,
        company_name: companyName,
        phone,
        website_url: websiteUrl,
        profile_url: profileUrl,
        address,
        latitude,
        longitude,
        categories,
        rating: null,
        review_count: null,
        raw_payload: element,
    }
    const { error: recordError } = await supabaseAdmin
        .from("leadgen_source_records")
        .insert(sourceRecord)
    if (recordError) throw recordError
    const { data: company, error: companyError } = await supabaseAdmin
        .from("leadgen_companies")
        .upsert({
            workspace_id: workspaceId,
            canonical_name: companyName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
            display_name: companyName,
            phone,
            website_domain: domainFromUrl(websiteUrl),
            website_url: websiteUrl,
            profile_url: profileUrl,
            source_key: "osm",
            source_record_id: sourceRecordId,
            address,
            latitude,
            longitude,
            categories,
            rating: null,
            review_count: null,
            industry_value: industryValue,
            location_value: locationValue,
            first_seen_poll_id: pollId,
            last_seen_at: new Date().toISOString(),
        }, { onConflict: "workspace_id,source_key,source_record_id" })
        .select("id")
        .single()
    if (companyError) throw companyError
    if (company?.id) {
        await recordEvidenceClaim({
            workspaceId,
            pollId,
            companyId: company.id,
            sourceKey: "osm",
            claimKind: "business_support",
            pointsAwarded: 1,
            confidence: 45,
            provenanceUrl: profileUrl,
            claimValue: { name: companyName, website_url: websiteUrl, categories },
            rawPayload: element as unknown as Record<string, unknown>,
        })
        if (phone) {
            await recordEvidenceClaim({
                workspaceId,
                pollId,
                companyId: company.id,
                sourceKey: "osm",
                claimKind: "business_phone",
                pointsAwarded: 1,
                confidence: 35,
                provenanceUrl: profileUrl,
                claimValue: { phone },
                rawPayload: element as unknown as Record<string, unknown>,
            })
        }
    }
    return true
}

export async function createOsmTasksForPoll({ workspaceId, pollId, plan }: { workspaceId: string; pollId: string; plan: LeadgenSourcePlanItem }) {
    if (plan.key !== "osm") return 0
    const [targetsResult, mappingsResult] = await Promise.all([
        supabaseAdmin
            .from("leadgen_source_location_mappings")
            .select("icp_location_value, native_values")
            .eq("source_key", "osm")
            .eq("enabled", true)
            .in("icp_location_value", plan.locations),
        supabaseAdmin
            .from("leadgen_source_industry_mappings")
            .select("icp_industry_value, native_values, native_label, metadata")
            .eq("source_key", "osm")
            .eq("enabled", true)
            .in("icp_industry_value", plan.industries),
    ])
    if (targetsResult.error) throw new Error(`Could not load OSM target location mappings: ${targetsResult.error.message}`)
    if (mappingsResult.error) throw new Error(`Could not load OSM category mappings: ${mappingsResult.error.message}`)
    const locationMappings = seedLocationMappingsWithFallbacks(plan.locations, (targetsResult.data ?? []) as LocationMapping[]) as LocationMapping[]
    const mappedTargetValues = [...new Set(locationMappings.flatMap((mapping) => Array.isArray(mapping.native_values) ? mapping.native_values : []))]
    if (mappedTargetValues.length === 0) return 0
    const [geoTargetsResult, icpTargetsResult] = await Promise.all([
        supabaseAdmin
            .from("leadgen_geo_targets")
            .select("value, label, latitude, longitude, radius_meters")
            .in("value", mappedTargetValues),
        supabaseAdmin
            .from("leadgen_icp_locations")
            .select("value, label, latitude, longitude, radius_meters")
            .eq("enabled", true)
            .in("value", mappedTargetValues),
    ])
    if (geoTargetsResult.error) throw new Error(`Could not load OSM target locations: ${geoTargetsResult.error.message}`)
    if (icpTargetsResult.error) throw new Error(`Could not load OSM ICP target locations: ${icpTargetsResult.error.message}`)
    const targetsByValue = new Map<string, GeoTarget>()
    for (const target of (icpTargetsResult.data ?? []) as GeoTarget[]) targetsByValue.set(target.value, target)
    for (const target of (geoTargetsResult.data ?? []) as GeoTarget[]) targetsByValue.set(target.value, target)
    const mappings = seedIndustryMappingsWithFallbacks("osm", plan.industries, (mappingsResult.data ?? []) as CategoryMapping[]) as CategoryMapping[]
    const tasks = mappings.flatMap((mapping) => locationMappings.flatMap((locationMapping) => (locationMapping.native_values ?? [])
        .map((nativeLocation) => targetsByValue.get(nativeLocation))
        .filter((target): target is GeoTarget => Boolean(target && typeof target.latitude === "number" && typeof target.longitude === "number"))
        .map((target) => {
            const radius = Math.min(40000, Math.max(1000, plan.radiusMeters ?? target.radius_meters ?? 24000))
            const limit = Math.min(50, Math.max(1, plan.limit ?? 25))
            return {
                poll_id: pollId,
                workspace_id: workspaceId,
                source_key: "osm",
                stage_key: "seed",
                industry_value: mapping.icp_industry_value,
                location_value: locationMapping.icp_location_value,
                status: "queued",
                source_query: {
                    query: buildOverpassQuery(target, mapping, radius, limit),
                    tags: (Array.isArray(mapping.metadata?.osm_tags) ? mapping.metadata.osm_tags : mapping.native_values) ?? [],
                    target: target.label,
                    native_location: target.value,
                    radius_meters: radius,
                    limit,
                },
            }
        })))
    if (tasks.length === 0) return 0
    const { error } = await supabaseAdmin.from("leadgen_poll_tasks").insert(tasks)
    if (error) throw error
    return tasks.length
}

export async function processOsmPoll(pollId: string, workspaceId: string, options: { finalize?: boolean } = {}) {
    await setLeadgenPollStatus(pollId, workspaceId, "running")
    const tasksResult = await supabaseAdmin
        .from("leadgen_poll_tasks")
        .select("id, industry_value, location_value, source_query")
        .eq("poll_id", pollId)
        .eq("workspace_id", workspaceId)
        .eq("source_key", "osm")
        .eq("status", "queued")
        .order("created_at", { ascending: true })
    if (tasksResult.error) {
        await setLeadgenPollStatus(pollId, workspaceId, "failed", `Could not load OSM tasks: ${tasksResult.error.message}`, true)
        return
    }
    const tasks = tasksResult.data ?? []
    if (tasks.length === 0) {
        if (options.finalize !== false) await setLeadgenPollStatus(pollId, workspaceId, "failed", "No queued OSM tasks were available for this poll.", true)
        return
    }
    for (const task of tasks) {
        await supabaseAdmin.from("leadgen_poll_tasks").update({ status: "running", started_at: new Date().toISOString(), error: null }).eq("id", task.id)
        try {
            const query = task.source_query as { query?: string; target?: string; tags?: string[] }
            if (!query.query) throw new Error("Missing Overpass query.")
            const payload = await fetchOverpass(query.query)
            const elements = Array.isArray(payload?.elements) ? payload.elements as OsmElement[] : []
            if (elements.length === 0) {
                const target = query.target ?? task.location_value
                const tags = Array.isArray(query.tags) ? query.tags.map(String).join(", ") : "mapped OSM tags"
                throw new Error(`OpenStreetMap returned 0 place records for ${task.industry_value ?? "this industry"} in ${target ?? "this location"} using ${tags}. The source query ran, but the public OSM data did not contain matching records for this mapped target.`)
            }
            let companyCount = 0
            for (const element of elements) {
                const stored = await upsertOsmElement({ workspaceId, pollId, taskId: task.id, industryValue: task.industry_value, locationValue: task.location_value, element })
                if (stored) companyCount += 1
            }
            await supabaseAdmin.from("leadgen_poll_tasks").update({ status: "completed", raw_count: elements.length, company_count: companyCount, completed_at: new Date().toISOString(), error: null }).eq("id", task.id)
        } catch (error) {
            if (isTransientOverpassError(error)) {
                await supabaseAdmin
                    .from("leadgen_poll_tasks")
                    .update({ status: "failed", completed_at: new Date().toISOString(), error: compactErrorMessage(publicOverpassUnavailableMessage(error)) })
                    .eq("id", task.id)
                break
            }
            await supabaseAdmin.from("leadgen_poll_tasks").update({ status: "failed", completed_at: new Date().toISOString(), error: compactErrorMessage(error) }).eq("id", task.id)
        }
        await sleep(OVERPASS_REQUEST_DELAY_MS)
    }
    if (options.finalize === false) {
        await refreshLeadgenPollCounts(pollId, workspaceId)
        return
    }
    await finalizeLeadgenPoll(pollId, workspaceId)
}
