import { supabaseAdmin } from "@/lib/supabase/admin"
import type { LeadgenSourceKey, LeadgenSourcePlanItem } from "@/lib/leadgen/sources"
import { refreshLeadgenPollCounts, setLeadgenPollStatus } from "@/lib/leadgen/osm-worker"
import { queryOverturePlaces, type OverturePlaceRecord } from "@/lib/leadgen/overture-duckdb"
import { queryAllThePlaces, queryFoursquareOsPlaces, type PlaceSeedRecord } from "@/lib/leadgen/place-seed-sources"
import { recordEvidenceClaim, updateInvestigationTask } from "@/lib/leadgen/evidence-scoring"
import type { PollStageKey } from "@/lib/leadgen/staged-poll"
import { runWithConcurrency } from "@/lib/leadgen/task-execution"
import {
    seedIndustryMappingsWithFallbacks,
    seedLocationMappingsWithFallbacks,
    type SeedIndustryMapping,
    type SeedLocationMapping,
    type SeedLocationTarget,
    type SeedSourceKey,
} from "@/lib/leadgen/seed-source-fallbacks"
import {
    crawlScore,
    defaultWebsiteUrls,
    discoverSitemapUrls,
    discoverWebsiteUrlsFromHtml,
    extractPageEvidenceWithPersonGate,
    fetchWebsitePage,
    sameSiteUrl,
    type PageExtraction,
    type WebsiteStageKey,
} from "./website-owner-discovery"

type CompanySeed = {
    id: string
    display_name: string
    phone: string | null
    website_url: string | null
    profile_url: string | null
    source_key: string
    source_record_id: string
}

type PipelineTask = {
    id: string
    source_key: LeadgenSourceKey
    stage_key: PollStageKey
    source_query: Record<string, unknown>
    industry_value?: string | null
    location_value?: string | null
}

type SamEntity = Record<string, unknown>

const SAM_NAICS_BY_INDUSTRY: Record<string, string[]> = {
    roofers: ["238160"],
    remodellers: ["236118", "236115", "236116", "236220"],
    plumbers: ["238220"],
    hvac_contractors: ["238220"],
    electricians: ["238210"],
    landscapers: ["561730"],
    painters: ["238320"],
    pool_builders: ["238990", "561790"],
    general_contractors: ["236115", "236116", "236220"],
    flooring_contractors: ["238330"],
    cleaning_companies: ["561720", "561740", "561790"],
    pest_control: ["561710"],
    lighting_contractors: ["238210"],
    auto_repair: ["811111", "811112", "811113", "811118"],
    waste_disposal: ["562111", "562119", "562212"],
    fencing_contractors: ["238990"],
    tree_services: ["561730"],
    solar_installers: ["238210", "221114"],
    restoration_companies: ["562910", "236118"],
    water_well_services: ["237110"],
}

const SOURCE_STAGE: Partial<Record<LeadgenSourceKey, string>> = {
    overture: "candidate_seed",
    alltheplaces: "candidate_seed",
    foursquare_os_places: "candidate_seed",
    website: "owner_phone_extraction",
    sam_gov: "sam_enrichment",
}

const PIPELINE_SEED_SOURCES = new Set<LeadgenSourceKey>(["overture", "alltheplaces", "foursquare_os_places"])
const WEBSITE_STALE_TASK_MS = 90_000
const WEBSITE_CRAWL_LIMITS: Record<Exclude<PollStageKey, "seed">, { maxPages: number; timeoutSeconds: number; budgetMs: number }> = {
    business_validation: { maxPages: 1, timeoutSeconds: 4, budgetMs: 6_000 },
    owner_identity: { maxPages: 4, timeoutSeconds: 4, budgetMs: 16_000 },
    owner_phone: { maxPages: 6, timeoutSeconds: 4, budgetMs: 22_000 },
    phone_validation: { maxPages: 0, timeoutSeconds: 1, budgetMs: 1_000 },
}
const WEBSITE_TASK_CONCURRENCY: Record<Exclude<PollStageKey, "seed">, number> = {
    business_validation: 2,
    owner_identity: 4,
    owner_phone: 4,
    phone_validation: 1,
}

function compactErrorMessage(error: unknown) {
    const message = error instanceof Error ? error.message : "Leadgen source task failed."
    return message.length > 900 ? `${message.slice(0, 900)}…` : message
}

class SamGovQuotaError extends Error {
    readonly nextAccessTime: string | null

    constructor(message: string, nextAccessTime: string | null) {
        super(message)
        this.name = "SamGovQuotaError"
        this.nextAccessTime = nextAccessTime
    }
}

function samQuotaMessage(responseText: string) {
    try {
        const payload = JSON.parse(responseText) as { nextAccessTime?: unknown; description?: unknown; message?: unknown }
        const nextAccessTime = typeof payload.nextAccessTime === "string" ? payload.nextAccessTime : null
        const description = typeof payload.description === "string" ? payload.description : null
        const message = typeof payload.message === "string" ? payload.message : null
        return {
            nextAccessTime,
            message: nextAccessTime
                ? `SAM.gov quota is exhausted. Next access time: ${nextAccessTime}.`
                : `SAM.gov quota is exhausted.${description || message ? ` ${description ?? message}` : ""}`,
        }
    } catch {
        return { nextAccessTime: null, message: `SAM.gov quota is exhausted. ${responseText.slice(0, 300)}` }
    }
}

function normalisePhone(value: string | null | undefined) {
    const raw = value?.trim()
    if (!raw) return null
    const digits = raw.replace(/\D/g, "")
    if (digits.length === 10) return `+1${digits}`
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
    return digits.length >= 8 ? `+${digits}` : null
}

function uniqueValues(values: Array<string | null | undefined>) {
    return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function asString(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : null
}

function titleCaseFromValue(value: string | null | undefined) {
    return value?.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) ?? null
}

function domainFromUrl(value: string | null | undefined) {
    if (!value) return null
    try {
        return new URL(value.startsWith("http") ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, "") || null
    } catch {
        return null
    }
}

function numberValue(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : null
}

async function createMappedTasksForPoll({ workspaceId, pollId, plan }: { workspaceId: string; pollId: string; plan: LeadgenSourcePlanItem }) {
    const sourceStage = SOURCE_STAGE[plan.key]
    if (!sourceStage) return 0
    if (plan.key === "website") return createWebsiteTasksForPoll({ workspaceId, pollId, plan })
    const usesSeedFallbacks = PIPELINE_SEED_SOURCES.has(plan.key)
    const [industryMappingsResult, locationMappingsResult, icpTargetsResult, geoTargetsResult] = await Promise.all([
        supabaseAdmin
            .from("leadgen_source_industry_mappings")
            .select("icp_industry_value, native_values, native_label, metadata")
            .eq("source_key", plan.key)
            .eq("enabled", true)
            .in("icp_industry_value", plan.industries),
        supabaseAdmin
            .from("leadgen_source_location_mappings")
            .select("icp_location_value, native_values, metadata")
            .eq("source_key", plan.key)
            .eq("enabled", true)
            .in("icp_location_value", plan.locations),
        usesSeedFallbacks
            ? supabaseAdmin
                .from("leadgen_icp_locations")
                .select("value, label, location_kind, country, region, locality, latitude, longitude, radius_meters")
                .eq("enabled", true)
                .in("value", plan.locations)
            : Promise.resolve({ data: [], error: null }),
        usesSeedFallbacks
            ? supabaseAdmin
                .from("leadgen_geo_targets")
                .select("value, label, country, region, locality, latitude, longitude, radius_meters")
                .eq("enabled", true)
                .in("value", plan.locations)
            : Promise.resolve({ data: [], error: null }),
    ])
    if (industryMappingsResult.error) throw new Error(`Could not load ${plan.label} industry mappings: ${industryMappingsResult.error.message}`)
    if (locationMappingsResult.error) throw new Error(`Could not load ${plan.label} location mappings: ${locationMappingsResult.error.message}`)
    if (icpTargetsResult.error) throw new Error(`Could not load ${plan.label} ICP location targets: ${icpTargetsResult.error.message}`)
    if (geoTargetsResult.error) throw new Error(`Could not load ${plan.label} geo targets: ${geoTargetsResult.error.message}`)
    const rawIndustryMappings = (industryMappingsResult.data ?? []) as SeedIndustryMapping[]
    const rawLocationMappings = (locationMappingsResult.data ?? []) as SeedLocationMapping[]
    const locationTargets = [
        ...((icpTargetsResult.data ?? []) as SeedLocationTarget[]),
        ...((geoTargetsResult.data ?? []) as SeedLocationTarget[]),
    ]
    const industryMappings = usesSeedFallbacks
        ? seedIndustryMappingsWithFallbacks(plan.key as SeedSourceKey, plan.industries, rawIndustryMappings)
        : rawIndustryMappings
    const locationMappings = usesSeedFallbacks
        ? seedLocationMappingsWithFallbacks(plan.locations, rawLocationMappings, locationTargets)
        : rawLocationMappings
    const tasks = industryMappings.flatMap((industry) => locationMappings.flatMap((location) => {
        const industryValues = Array.isArray(industry.native_values) ? industry.native_values : []
        const locationValues = Array.isArray(location.native_values) ? location.native_values : []
        if (industryValues.length === 0 || locationValues.length === 0) return []
        return [{
            poll_id: pollId,
            workspace_id: workspaceId,
            source_key: plan.key,
            stage_key: PIPELINE_SEED_SOURCES.has(plan.key) ? "seed" : "business_validation",
            stage: sourceStage,
            industry_value: industry.icp_industry_value,
            location_value: location.icp_location_value,
            status: "queued",
            source_query: {
                source_key: plan.key,
                stage: sourceStage,
                native_industries: industryValues,
                native_locations: locationValues,
                native_label: industry.native_label,
                industry_mapping: industry,
                location_mapping: location,
                limit: plan.limit ?? 25,
                candidate_target_count: PIPELINE_SEED_SOURCES.has(plan.key) ? plan.limit ?? 10 : null,
                radius_meters: plan.radiusMeters,
                release: plan.release,
            },
        }]
    }))
    if (tasks.length === 0) return 0
    const { error } = await supabaseAdmin.from("leadgen_poll_tasks").insert(tasks)
    if (error) throw error
    return tasks.length
}

export async function createWebsiteTasksForPoll({ workspaceId, pollId, plan, companyIds, stageKey = "owner_phone" }: { workspaceId: string; pollId: string; plan: LeadgenSourcePlanItem; companyIds?: string[]; stageKey?: Exclude<PollStageKey, "seed"> }) {
    if (plan.key !== "website") return 0
    let companiesQuery = supabaseAdmin
        .from("leadgen_companies")
        .select("id, display_name, phone, website_url, profile_url, source_key, source_record_id")
        .eq("workspace_id", workspaceId)
        .eq("first_seen_poll_id", pollId)
        .not("website_url", "is", null)
        .limit(Math.min(200, Math.max(1, plan.limit ?? 50)))
    if (companyIds?.length) companiesQuery = companiesQuery.in("id", companyIds)
    const companiesResult = await companiesQuery
    if (companiesResult.error) throw new Error(`Could not load companies for website crawling: ${companiesResult.error.message}`)
    const companies = (companiesResult.data ?? []) as CompanySeed[]
    const tasks = companies.flatMap((company) => company.website_url ? [{
        poll_id: pollId,
        workspace_id: workspaceId,
        source_key: "website",
        stage_key: stageKey,
        stage: "owner_phone_extraction",
        candidate_id: null,
        industry_value: null,
        location_value: null,
        status: "queued",
        source_query: {
            company_id: company.id,
            company_name: company.display_name,
            website_url: company.website_url,
            crawl_depth: plan.crawlDepth ?? 2,
            timeout_seconds: plan.timeoutSeconds ?? 10,
            respect_robots: plan.respectRobots !== false,
        },
    }] : [])
    if (tasks.length === 0) return 0
    const existingResult = await supabaseAdmin
        .from("leadgen_poll_tasks")
        .select("source_query")
        .eq("workspace_id", workspaceId)
        .eq("poll_id", pollId)
        .eq("source_key", "website")
        .eq("stage_key", stageKey)
    if (existingResult.error) throw new Error(`Could not inspect existing website crawl tasks: ${existingResult.error.message}`)
    const existingCompanyIds = new Set((existingResult.data ?? [])
        .map((task) => asRecord(task.source_query)?.company_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0))
    const newTasks = tasks.filter((task) => {
        const companyId = typeof task.source_query.company_id === "string" ? task.source_query.company_id : null
        return companyId && !existingCompanyIds.has(companyId)
    })
    if (newTasks.length === 0) return 0
    const { error } = await supabaseAdmin.from("leadgen_poll_tasks").insert(newTasks)
    if (error) throw error
    return newTasks.length
}

export async function createPipelineTasksForPoll({ workspaceId, pollId, plans }: { workspaceId: string; pollId: string; plans: LeadgenSourcePlanItem[] }) {
    const taskCounts = await Promise.all(plans.map((plan) => createMappedTasksForPoll({ workspaceId, pollId, plan })))
    return taskCounts.reduce((total, count) => total + count, 0)
}

async function processBlockedExternalTask() {
    return { rawCount: 0, companyCount: 0 }
}

function valuesFromQuery(value: unknown) {
    return Array.isArray(value) ? value.map(String).filter(Boolean) : []
}

function stateFromLocationMapping(locationMapping: unknown, nativeLocation: string | null) {
    const mapping = asRecord(locationMapping)
    const metadata = asRecord(mapping?.metadata)
    const region = asString(metadata?.region)
    if (region && /^[A-Z]{2}$/i.test(region)) return region.toUpperCase()
    const match = nativeLocation?.match(/_([a-z]{2})$/i)
    return match ? match[1].toUpperCase() : null
}

function overtureLocationFromTask(task: PipelineTask) {
    const mapping = asRecord(task.source_query.location_mapping)
    const metadata = asRecord(mapping?.metadata)
    return {
        label: asString(metadata?.locality) ?? asString(metadata?.region) ?? task.location_value ?? null,
        latitude: numberValue(metadata?.latitude),
        longitude: numberValue(metadata?.longitude),
        radiusMeters: numberValue(metadata?.radius_meters) ?? numberValue(task.source_query.radius_meters),
    }
}

function samNaicsCodesForTask(task: PipelineTask) {
    const nativeIndustries = valuesFromQuery(task.source_query.native_industries)
    const nativeNaics = nativeIndustries.filter((value) => /^\d{6}$/.test(value))
    const mapped = task.industry_value ? SAM_NAICS_BY_INDUSTRY[task.industry_value] ?? [] : []
    return uniqueValues([...nativeNaics, ...mapped])
}

function extractSamEntities(payload: unknown): SamEntity[] {
    const root = asRecord(payload)
    const direct = root?.entityData ?? root?.entities ?? root?.results ?? root?.data
    if (Array.isArray(direct)) return direct.filter((item): item is SamEntity => Boolean(asRecord(item)))
    const embedded = asRecord(root?._embedded)
    const embeddedData = embedded?.entityData ?? embedded?.entities ?? embedded?.results
    return Array.isArray(embeddedData) ? embeddedData.filter((item): item is SamEntity => Boolean(asRecord(item))) : []
}

function nestedRecord(source: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
        const value = asRecord(source[key])
        if (value) return value
    }
    return null
}

function nestedArray(source: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
        const value = source[key]
        if (Array.isArray(value)) return value
    }
    return []
}

function samEntityRegistration(entity: SamEntity) {
    return nestedRecord(entity, ["entityRegistration", "registration", "entity"])
}

function samCoreData(entity: SamEntity) {
    return nestedRecord(entity, ["coreData", "core"])
}

function samAddress(entity: SamEntity) {
    const registration = samEntityRegistration(entity)
    const core = samCoreData(entity)
    const address = nestedRecord(registration ?? {}, ["physicalAddress", "address"]) ?? nestedRecord(core ?? {}, ["physicalAddress", "address"]) ?? {}
    return {
        street: [asString(address.addressLine1), asString(address.addressLine2)].filter(Boolean).join(" ") || null,
        city: asString(address.city) ?? asString(address.physicalAddressCity),
        state: asString(address.stateOrProvinceCode) ?? asString(address.physicalAddressProvinceOrStateCode),
        postcode: asString(address.zipCode) ?? asString(address.zip) ?? asString(address.postalCode),
        country: asString(address.countryCode) ?? asString(address.country),
    }
}

function samCompanyName(entity: SamEntity) {
    const registration = samEntityRegistration(entity)
    return asString(registration?.legalBusinessName)
        ?? asString(registration?.dbaName)
        ?? asString(entity.legalBusinessName)
        ?? asString(entity.entityName)
        ?? asString(entity.name)
}

function samRecordId(entity: SamEntity) {
    const registration = samEntityRegistration(entity)
    return asString(registration?.ueiSAM)
        ?? asString(registration?.uei)
        ?? asString(entity.ueiSAM)
        ?? asString(entity.uei)
        ?? asString(registration?.cageCode)
        ?? asString(entity.cageCode)
        ?? null
}

function collectSamContacts(entity: SamEntity) {
    const contactsRoot = asRecord(entity.pointsOfContact) ?? asRecord(entity.pointOfContact) ?? {}
    const arrays = [
        ...nestedArray(contactsRoot, ["governmentBusinessPOC", "governmentBusinessPoc", "pastPerformancePOC", "electronicBusinessPOC", "accountsReceivablePOC"]),
        ...nestedArray(entity, ["pointsOfContact"]),
    ]
    const singletonContacts = Object.values(contactsRoot).filter((value) => asRecord(value)) as Record<string, unknown>[]
    const candidates = [...arrays, ...singletonContacts].map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => Boolean(item))
    return candidates.map((contact) => {
        const fullName = asString(contact.fullName)
            ?? asString([asString(contact.firstName), asString(contact.middleInitial), asString(contact.lastName)].filter(Boolean).join(" "))
            ?? asString(contact.name)
        const phone = normalisePhone(asString(contact.phone) ?? asString(contact.telephone) ?? asString(contact.usPhone) ?? asString(contact.nonUSPhone))
        const email = asString(contact.email) ?? asString(contact.emailAddress)
        const role = asString(contact.pocType) ?? asString(contact.type) ?? asString(contact.title)
        return { fullName: fullName || null, phone, email, role, raw: contact }
    }).filter((contact) => contact.fullName || contact.phone || contact.email)
}

async function fetchSamEntities(task: PipelineTask) {
    const apiKey = process.env.SAM_GOV_API_KEY
    if (!apiKey) throw new Error("SAM.gov is enabled, but SAM_GOV_API_KEY is not configured in Vercel.")
    const nativeIndustries = valuesFromQuery(task.source_query.native_industries)
    const nativeLocations = valuesFromQuery(task.source_query.native_locations)
    const locationMapping = task.source_query.location_mapping
    const industryQuery = titleCaseFromValue(nativeIndustries[0] ?? task.industry_value ?? null)
    const state = stateFromLocationMapping(locationMapping, nativeLocations[0] ?? null)
    const naicsCodes = samNaicsCodesForTask(task)
    const attempts = naicsCodes.length
        ? naicsCodes.map((naics) => ({ kind: "primaryNaics", value: naics }))
        : industryQuery
            ? [{ kind: "q", value: industryQuery }]
            : []
    const payloads: unknown[] = []
    const queryUrls: string[] = []
    for (const attempt of attempts) {
        const url = new URL("https://api.sam.gov/entity-information/v4/entities")
        url.searchParams.set("api_key", apiKey)
        url.searchParams.set("includeSections", "entityRegistration,coreData,pointsOfContact")
        url.searchParams.set("samRegistered", "Yes")
        url.searchParams.set("registrationStatus", "A")
        url.searchParams.set(attempt.kind, attempt.value)
        if (state) url.searchParams.set("physicalAddressProvinceOrStateCode", state)
        const response = await fetch(url, {
            headers: { Accept: "application/json", "User-Agent": "BetelgezeLeadgen/1.0 (contact: hello@betelgeze.com)" },
            cache: "no-store",
        })
        const responseText = await response.text()
        queryUrls.push(url.toString().replace(apiKey, "[redacted]"))
        if (response.status === 429) {
            const quota = samQuotaMessage(responseText)
            throw new SamGovQuotaError(quota.message, quota.nextAccessTime)
        }
        if (!response.ok) throw new Error(`SAM.gov returned HTTP ${response.status}: ${responseText.slice(0, 500)}`)
        const payload = JSON.parse(responseText) as unknown
        payloads.push(payload)
        if (extractSamEntities(payload).length > 0) break
    }
    if (payloads.length === 0) throw new Error("SAM.gov could not build a mapped query for this ICP industry/location. Add a NAICS mapping for the industry.")
    return { payloads, queryUrls, attemptedNaics: naicsCodes }
}

async function upsertSamEntity({ workspaceId, pollId, task, entity }: { workspaceId: string; pollId: string; task: PipelineTask; entity: SamEntity }) {
    const companyName = samCompanyName(entity)
    const sourceRecordId = samRecordId(entity)
    if (!companyName || !sourceRecordId) return false
    const { data: existingRecord, error: existingError } = await supabaseAdmin
        .from("leadgen_source_records")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("source_key", "sam_gov")
        .eq("source_record_id", sourceRecordId)
        .maybeSingle()
    if (existingError) throw existingError
    if (existingRecord) return false
    const contacts = collectSamContacts(entity)
    const bestContact = contacts.find((contact) => contact.fullName && contact.phone) ?? contacts.find((contact) => contact.phone) ?? contacts[0] ?? null
    const core = samCoreData(entity)
    const websiteUrl = asString(core?.entityURL) ?? asString(core?.websiteURL) ?? asString(core?.website)
    const address = samAddress(entity)
    const phone = bestContact?.phone ?? null
    const sourceRecord = {
        workspace_id: workspaceId,
        poll_id: pollId,
        task_id: task.id,
        source_key: "sam_gov",
        source_record_id: sourceRecordId,
        company_name: companyName,
        phone,
        website_url: websiteUrl,
        profile_url: `https://sam.gov/entity/${sourceRecordId}/coreData`,
        address,
        latitude: null,
        longitude: null,
        categories: [{ key: "sam_gov", value: task.industry_value ?? "entity" }],
        rating: null,
        review_count: null,
        raw_payload: entity,
    }
    const { error: recordError } = await supabaseAdmin
        .from("leadgen_source_records")
        .insert(sourceRecord)
    if (recordError) throw recordError
    const companyPayload = {
        workspace_id: workspaceId,
        canonical_name: companyName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
        display_name: companyName,
        phone,
        website_domain: domainFromUrl(websiteUrl),
        website_url: websiteUrl,
        profile_url: sourceRecord.profile_url,
        source_key: "sam_gov",
        source_record_id: sourceRecordId,
        address,
        latitude: null,
        longitude: null,
        categories: sourceRecord.categories,
        rating: null,
        review_count: null,
        industry_value: task.industry_value,
        location_value: task.location_value,
        first_seen_poll_id: pollId,
        owner_name: bestContact?.fullName ?? null,
        owner_phone: bestContact?.phone ?? null,
        owner_source_key: bestContact ? "sam_gov" : null,
        owner_confidence: bestContact?.phone ? 70 : bestContact ? 45 : null,
        owner_evidence: bestContact ? { source: "sam_gov", role: bestContact.role, email: bestContact.email, contacts } : null,
        last_seen_at: new Date().toISOString(),
    }
    const { data: company, error: companyError } = await supabaseAdmin
        .from("leadgen_companies")
        .upsert(companyPayload, { onConflict: "workspace_id,source_key,source_record_id" })
        .select("id")
        .single()
    if (companyError) throw companyError
    if (company?.id) {
        await recordEvidenceClaim({
            workspaceId,
            pollId,
            companyId: company.id,
            sourceKey: "sam_gov",
            claimKind: "business_support",
            pointsAwarded: 2,
            confidence: 70,
            provenanceUrl: sourceRecord.profile_url,
            claimValue: { legal_name: companyName, source_record_id: sourceRecordId },
            rawPayload: { entity },
        })
    }
    if (company?.id && bestContact) {
        await supabaseAdmin.from("leadgen_evidence").insert({
            workspace_id: workspaceId,
            poll_id: pollId,
            company_id: company.id,
            source_key: "sam_gov",
            evidence_kind: "sam_public_poc",
            confidence: bestContact.phone ? 70 : 45,
            value: { owner_name: bestContact.fullName, phone: bestContact.phone, email: bestContact.email, role: bestContact.role },
            raw_payload: { contacts },
        })
        if (bestContact.fullName) {
            await recordEvidenceClaim({
                workspaceId,
                pollId,
                companyId: company.id,
                sourceKey: "sam_gov",
                claimKind: "owner_identity",
                pointsAwarded: 2,
                confidence: bestContact.phone ? 70 : 45,
                provenanceUrl: sourceRecord.profile_url,
                claimValue: { owner_name: bestContact.fullName, role: bestContact.role, email: bestContact.email },
                rawPayload: { contacts },
            })
        }
        if (bestContact.phone) {
            await recordEvidenceClaim({
                workspaceId,
                pollId,
                companyId: company.id,
                sourceKey: "sam_gov",
                claimKind: "owner_phone",
                pointsAwarded: 2,
                confidence: 70,
                provenanceUrl: sourceRecord.profile_url,
                claimValue: { owner_name: bestContact.fullName, owner_phone: bestContact.phone, role: bestContact.role },
                rawPayload: { contacts },
            })
        }
    }
    return true
}

async function processSamGovTask(task: PipelineTask) {
    const workspaceId = typeof task.source_query.workspace_id === "string" ? task.source_query.workspace_id : null
    const pollId = typeof task.source_query.poll_id === "string" ? task.source_query.poll_id : null
    if (!workspaceId || !pollId) throw new Error("SAM.gov task is missing workspace or poll context.")
    const { payloads, queryUrls, attemptedNaics } = await fetchSamEntities(task)
    const entitiesById = new Map<string, SamEntity>()
    for (const payload of payloads) {
        for (const entity of extractSamEntities(payload)) {
            entitiesById.set(samRecordId(entity) ?? JSON.stringify(entity).slice(0, 80), entity)
        }
    }
    const entities = [...entitiesById.values()]
    if (entities.length === 0) throw new Error(`SAM.gov returned 0 entities after ${queryUrls.length} mapped ${attemptedNaics.length ? "NAICS" : "text"} attempt${queryUrls.length === 1 ? "" : "s"}. Queries: ${queryUrls.join(" | ")}`)
    let companyCount = 0
    for (const entity of entities) {
        const stored = await upsertSamEntity({ workspaceId, pollId, task, entity })
        if (stored) companyCount += 1
    }
    return { rawCount: entities.length, companyCount }
}

async function upsertOverturePlace({ workspaceId, pollId, task, place }: { workspaceId: string; pollId: string; task: PipelineTask; place: OverturePlaceRecord }) {
    if (!place.name) return false
    const { data: existingRecord, error: existingError } = await supabaseAdmin
        .from("leadgen_source_records")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("source_key", "overture")
        .eq("source_record_id", place.id)
        .maybeSingle()
    if (existingError) throw existingError
    if (existingRecord) return false
    const sourceRecord = {
        workspace_id: workspaceId,
        poll_id: pollId,
        task_id: task.id,
        source_key: "overture",
        source_record_id: place.id,
        company_name: place.name,
        phone: normalisePhone(place.phone),
        website_url: place.website_url,
        profile_url: null,
        address: place.address,
        latitude: place.latitude,
        longitude: place.longitude,
        categories: place.categories,
        rating: null,
        review_count: null,
        raw_payload: place.raw_payload,
    }
    const { error: recordError } = await supabaseAdmin
        .from("leadgen_source_records")
        .insert(sourceRecord)
    if (recordError) throw recordError
    const companyPayload = {
        workspace_id: workspaceId,
        canonical_name: place.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
        display_name: place.name,
        phone: sourceRecord.phone,
        website_domain: domainFromUrl(place.website_url),
        website_url: place.website_url,
        profile_url: null,
        source_key: "overture",
        source_record_id: place.id,
        address: place.address,
        latitude: place.latitude,
        longitude: place.longitude,
        categories: place.categories,
        rating: null,
        review_count: null,
        industry_value: task.industry_value,
        location_value: task.location_value,
        first_seen_poll_id: pollId,
        last_seen_at: new Date().toISOString(),
    }
    const { data: company, error: companyError } = await supabaseAdmin
        .from("leadgen_companies")
        .upsert(companyPayload, { onConflict: "workspace_id,source_key,source_record_id" })
        .select("id")
        .single()
    if (companyError) throw companyError
    if (company?.id) {
        await recordEvidenceClaim({
            workspaceId,
            pollId,
            companyId: company.id,
            sourceKey: "overture",
            claimKind: "business_support",
            pointsAwarded: 1,
            confidence: 55,
            claimValue: { name: place.name, phone: sourceRecord.phone, website_url: place.website_url },
            rawPayload: place.raw_payload,
        })
        if (sourceRecord.phone) {
            await recordEvidenceClaim({
                workspaceId,
                pollId,
                companyId: company.id,
                sourceKey: "overture",
                claimKind: "business_phone",
                pointsAwarded: 1,
                confidence: 45,
                claimValue: { phone: sourceRecord.phone },
                rawPayload: place.raw_payload,
            })
        }
    }
    return true
}

async function processOvertureTask(task: PipelineTask) {
    const workspaceId = typeof task.source_query.workspace_id === "string" ? task.source_query.workspace_id : null
    const pollId = typeof task.source_query.poll_id === "string" ? task.source_query.poll_id : null
    if (!workspaceId || !pollId) throw new Error("Overture task is missing workspace or poll context.")
    const categories = valuesFromQuery(task.source_query.native_industries)
    const location = overtureLocationFromTask(task)
    const candidateTargetCount = Math.min(500, Math.max(1, Number(task.source_query.candidate_target_count) || Number(task.source_query.limit) || 10))
    const existingPollCompaniesResult = await supabaseAdmin
        .from("leadgen_companies")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("first_seen_poll_id", pollId)
    if (existingPollCompaniesResult.error) throw existingPollCompaniesResult.error
    const remainingCandidateSlots = candidateTargetCount - (existingPollCompaniesResult.count ?? 0)
    if (remainingCandidateSlots <= 0) return { rawCount: 0, companyCount: 0 }
    const limit = Math.min(500, Math.max(1, Math.min(remainingCandidateSlots, Number(task.source_query.limit) || 100)))
    const release = typeof task.source_query.release === "string" ? task.source_query.release : null
    const { data: existingRecords, error: existingError } = await supabaseAdmin
        .from("leadgen_source_records")
        .select("source_record_id")
        .eq("workspace_id", workspaceId)
        .eq("source_key", "overture")
        .limit(5_000)
    if (existingError) throw existingError
    const excludeIds = (existingRecords ?? [])
        .map((record) => typeof record.source_record_id === "string" ? record.source_record_id : null)
        .filter((id): id is string => Boolean(id))
    const places = await queryOverturePlaces({ categories, location, limit, release, excludeIds })
    if (places.length === 0) {
        const unseenContext = excludeIds.length > 0 ? ` after excluding ${excludeIds.length.toLocaleString()} records already seen by this workspace` : ""
        throw new Error(`Overture returned 0 new place records for ${task.industry_value ?? "this industry"} in ${location.label ?? task.location_value ?? "this location"} using ${categories.join(", ")}${unseenContext}.`)
    }
    let companyCount = 0
    for (const place of places) {
        const stored = await upsertOverturePlace({ workspaceId, pollId, task, place })
        if (stored) companyCount += 1
    }
    return { rawCount: places.length, companyCount }
}

async function existingSourceRecordIds(workspaceId: string, sourceKey: LeadgenSourceKey) {
    const { data: existingRecords, error: existingError } = await supabaseAdmin
        .from("leadgen_source_records")
        .select("source_record_id")
        .eq("workspace_id", workspaceId)
        .eq("source_key", sourceKey)
        .limit(5_000)
    if (existingError) throw existingError
    return (existingRecords ?? [])
        .map((record) => typeof record.source_record_id === "string" ? record.source_record_id : null)
        .filter((id): id is string => Boolean(id))
}

async function upsertPlaceSeedRecord({ workspaceId, pollId, task, place, sourceKey }: { workspaceId: string; pollId: string; task: PipelineTask; place: PlaceSeedRecord; sourceKey: "alltheplaces" | "foursquare_os_places" }) {
    if (!place.name) return false
    const { data: existingRecord, error: existingError } = await supabaseAdmin
        .from("leadgen_source_records")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("source_key", sourceKey)
        .eq("source_record_id", place.id)
        .maybeSingle()
    if (existingError) throw existingError
    if (existingRecord) return false
    const phone = normalisePhone(place.phone)
    const sourceRecord = {
        workspace_id: workspaceId,
        poll_id: pollId,
        task_id: task.id,
        source_key: sourceKey,
        source_record_id: place.id,
        company_name: place.name,
        phone,
        website_url: place.website_url,
        profile_url: place.profile_url,
        address: place.address,
        latitude: place.latitude,
        longitude: place.longitude,
        categories: place.categories,
        rating: null,
        review_count: null,
        raw_payload: place.raw_payload,
    }
    const { error: recordError } = await supabaseAdmin
        .from("leadgen_source_records")
        .insert(sourceRecord)
    if (recordError) throw recordError
    const companyPayload = {
        workspace_id: workspaceId,
        canonical_name: place.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
        display_name: place.name,
        phone,
        website_domain: domainFromUrl(place.website_url),
        website_url: place.website_url,
        profile_url: place.profile_url,
        source_key: sourceKey,
        source_record_id: place.id,
        address: place.address,
        latitude: place.latitude,
        longitude: place.longitude,
        categories: place.categories,
        rating: null,
        review_count: null,
        industry_value: task.industry_value,
        location_value: task.location_value,
        first_seen_poll_id: pollId,
        last_seen_at: new Date().toISOString(),
    }
    const { data: company, error: companyError } = await supabaseAdmin
        .from("leadgen_companies")
        .upsert(companyPayload, { onConflict: "workspace_id,source_key,source_record_id" })
        .select("id")
        .single()
    if (companyError) throw companyError
    if (company?.id) {
        await recordEvidenceClaim({
            workspaceId,
            pollId,
            companyId: company.id,
            sourceKey,
            claimKind: "business_support",
            pointsAwarded: 1,
            confidence: 45,
            provenanceUrl: place.profile_url ?? place.website_url,
            claimValue: { name: place.name, phone, website_url: place.website_url, categories: place.categories },
            rawPayload: place.raw_payload,
        })
        if (phone) {
            await recordEvidenceClaim({
                workspaceId,
                pollId,
                companyId: company.id,
                sourceKey,
                claimKind: "business_phone",
                pointsAwarded: 1,
                confidence: 35,
                provenanceUrl: place.profile_url ?? place.website_url,
                claimValue: { phone },
                rawPayload: place.raw_payload,
            })
        }
    }
    return true
}

async function processPlaceSeedTask(task: PipelineTask, sourceKey: "alltheplaces" | "foursquare_os_places") {
    const workspaceId = typeof task.source_query.workspace_id === "string" ? task.source_query.workspace_id : null
    const pollId = typeof task.source_query.poll_id === "string" ? task.source_query.poll_id : null
    if (!workspaceId || !pollId) throw new Error(`${sourceKey} task is missing workspace or poll context.`)
    const nativeTerms = valuesFromQuery(task.source_query.native_industries)
    const terms = uniqueValues([...nativeTerms, task.industry_value, task.source_query.native_label as string | null | undefined])
    const location = overtureLocationFromTask(task)
    const limit = Math.min(25, Math.max(1, Number(task.source_query.limit) || 10))
    const excludeIds = await existingSourceRecordIds(workspaceId, sourceKey)
    const places = sourceKey === "alltheplaces"
        ? await queryAllThePlaces({ terms, industry: task.industry_value, location, limit, release: typeof task.source_query.release === "string" ? task.source_query.release : null, excludeIds })
        : await queryFoursquareOsPlaces({ terms, location, limit, excludeIds })
    if (places.length === 0) {
        const label = sourceKey === "alltheplaces" ? "AllThePlaces" : "Foursquare OS Places"
        const unseenContext = excludeIds.length > 0 ? ` after excluding ${excludeIds.length.toLocaleString()} records already seen by this workspace` : ""
        throw new Error(`${label} returned 0 new place records for ${task.industry_value ?? "this industry"} in ${location.label ?? task.location_value ?? "this location"} using ${terms.join(", ") || "mapped terms"}${unseenContext}.`)
    }
    let companyCount = 0
    for (const place of places) {
        const stored = await upsertPlaceSeedRecord({ workspaceId, pollId, task, place, sourceKey })
        if (stored) companyCount += 1
    }
    return { rawCount: places.length, companyCount }
}

async function processWebsiteTask(task: PipelineTask) {
    const companyId = typeof task.source_query.company_id === "string" ? task.source_query.company_id : null
    const websiteUrl = typeof task.source_query.website_url === "string" ? task.source_query.website_url : null
    const companyName = typeof task.source_query.company_name === "string" ? task.source_query.company_name : null
    if (!companyId || !websiteUrl) throw new Error("Website crawler task is missing a company or website URL.")
    const workspaceId = typeof task.source_query.workspace_id === "string" ? task.source_query.workspace_id : ""
    const pollId = typeof task.source_query.poll_id === "string" ? task.source_query.poll_id : null
    const stageKey: WebsiteStageKey = task.stage_key === "seed" ? "business_validation" : task.stage_key
    if (workspaceId && pollId) {
        await updateInvestigationTask({ workspaceId, pollId, companyId, sourceKey: "website", stageKey, status: "running" })
        await updateInvestigationTask({ workspaceId, pollId, companyId, sourceKey: "web.json_ld", stageKey, status: "running" })
    }
    const crawlLimits = WEBSITE_CRAWL_LIMITS[stageKey] ?? WEBSITE_CRAWL_LIMITS.owner_identity
    const depth = Math.min(5, Math.max(1, Number(task.source_query.crawl_depth) || 2))
    const timeoutSeconds = Math.min(crawlLimits.timeoutSeconds, Math.max(2, Number(task.source_query.timeout_seconds) || crawlLimits.timeoutSeconds))
    const deadline = Date.now() + crawlLimits.budgetMs
    const inspected: PageExtraction[] = []
    const maxPages = depth <= 1 ? 1 : depth === 2 ? Math.min(crawlLimits.maxPages, stageKey === "owner_phone" ? 6 : 5) : crawlLimits.maxPages
    const sitemapUrls = Date.now() < deadline - 1500
        ? await discoverSitemapUrls(websiteUrl, stageKey, depth, Math.min(timeoutSeconds, Math.max(1, Math.ceil((deadline - Date.now()) / 1000)))).catch(() => [])
        : []
    const queued = new Set<string>()
    const queue: string[] = []
    const enqueue = (urls: string[]) => {
        const sorted = urls
            .filter((url) => sameSiteUrl(url, websiteUrl))
            .sort((left, right) => crawlScore(right, stageKey) - crawlScore(left, stageKey))
        for (const url of sorted) {
            if (queued.has(url) || crawlScore(url, stageKey) <= -20) continue
            queued.add(url)
            queue.push(url)
        }
    }
    enqueue([...defaultWebsiteUrls(websiteUrl, depth, stageKey), ...sitemapUrls])
    let ownerName: string | null = null
    let ownerPhone: string | null = null
    let ownerRole: string | null = null
    let ownerSourceUrl: string | null = null
    let ownerConfidence: number | null = null
    let businessPhone: string | null = null
    while (queue.length && inspected.length < maxPages) {
        const url = queue.shift()!
        if (Date.now() >= deadline) {
            inspected.push({ url, owner_name: null, phone: null, phones: [], evidence: ["crawl_budget_exhausted"] })
            break
        }
        try {
            const remainingSeconds = Math.max(1, Math.ceil((deadline - Date.now()) / 1000))
            const page = await fetchWebsitePage(url, Math.min(timeoutSeconds, remainingSeconds))
            if (!page) {
                inspected.push({ url, owner_name: null, phone: null, phones: [], evidence: ["non_text_response"] })
                continue
            }
            const extracted = await extractPageEvidenceWithPersonGate(url, page.html, page.visibleText, page.title, page.metaDescription, { businessNames: [companyName], stageKey })
            const discoveredLinks = discoverWebsiteUrlsFromHtml(websiteUrl, url, page.html, stageKey, depth)
            extracted.discovered_links = discoveredLinks.slice(0, 8)
            if (inspected.length + queue.length < maxPages + 8) enqueue(discoveredLinks)
            const pageOwner = extracted.owner_name
            const pageOwnerPhone = extracted.phone
            const pageBusinessPhone = extracted.phones[0] ?? null
            inspected.push(extracted)
            if (pageOwner) {
                const phoneBonus = stageKey === "owner_phone" ? 25 : 0
                const currentScore = (ownerConfidence ?? 0) + (ownerPhone ? phoneBonus : 0)
                const nextScore = (extracted.owner_confidence ?? 0) + (pageOwnerPhone ? phoneBonus : 0)
                if (!ownerName || nextScore > currentScore) {
                    ownerName = pageOwner
                    ownerPhone = pageOwnerPhone
                    ownerRole = extracted.owner_role ?? null
                    ownerSourceUrl = extracted.url
                    ownerConfidence = extracted.owner_confidence ?? null
                } else if (!ownerPhone && pageOwner.toLowerCase() === ownerName.toLowerCase() && pageOwnerPhone) {
                    ownerPhone = pageOwnerPhone
                }
            }
            businessPhone ||= pageBusinessPhone
            if (ownerName && ownerPhone) break
        } catch {
            inspected.push({ url, owner_name: null, phone: null, phones: [], evidence: ["fetch_failed"] })
        }
    }
    const { error: evidenceError } = await supabaseAdmin.from("leadgen_evidence").insert({
        workspace_id: workspaceId,
        company_id: companyId,
        poll_id: pollId,
        source_key: "website",
        evidence_kind: "website_owner_phone_extract",
        confidence: ownerName && ownerPhone ? Math.max(74, ownerConfidence ?? 0) : ownerName ? Math.max(45, ownerConfidence ?? 0) : businessPhone ? 25 : 15,
        value: {
            owner_name: ownerName,
            owner_phone: ownerPhone,
            owner_role: ownerRole,
            owner_source_url: ownerSourceUrl,
            business_phone: businessPhone,
            phones: uniqueValues(inspected.flatMap((page) => page.phones)),
            social_links: uniqueValues(inspected.flatMap((page) => page.social_links ?? [])),
            profile_links: uniqueValues(inspected.flatMap((page) => page.profile_links ?? [])),
        },
        raw_payload: { inspected, crawl_strategy: { max_pages: maxPages, sitemap_urls: sitemapUrls.slice(0, 12), queued_urls: [...queued].slice(0, 30) } },
    })
    if (evidenceError) throw evidenceError
    if (workspaceId && pollId) {
        await recordEvidenceClaim({
            workspaceId,
            pollId,
            companyId,
            sourceKey: "website",
            claimKind: "business_support",
            pointsAwarded: 1,
            confidence: 35,
            provenanceUrl: websiteUrl,
            claimValue: { website_url: websiteUrl, pages_inspected: inspected.length, sitemap_urls: sitemapUrls.length },
            rawPayload: { inspected, crawl_strategy: { max_pages: maxPages, sitemap_urls: sitemapUrls.slice(0, 12) } },
        })
        if (businessPhone) {
            await recordEvidenceClaim({
                workspaceId,
                pollId,
                companyId,
                sourceKey: "website",
                claimKind: "business_phone",
                pointsAwarded: 1,
                confidence: 35,
                provenanceUrl: websiteUrl,
                claimValue: { phone: businessPhone },
                rawPayload: { inspected },
            })
        }
        if (ownerName) {
            await recordEvidenceClaim({
                workspaceId,
                pollId,
                companyId,
                sourceKey: "website",
                claimKind: "owner_identity",
                pointsAwarded: 2,
                confidence: ownerPhone ? Math.max(74, ownerConfidence ?? 0) : Math.max(45, ownerConfidence ?? 0),
                provenanceUrl: ownerSourceUrl ?? websiteUrl,
                claimValue: {
                    owner_name: ownerName,
                    role: ownerRole,
                    source_url: ownerSourceUrl,
                    snippets: inspected.flatMap((page) => page.snippets ?? []).filter((snippet) => snippet.name === ownerName).slice(0, 3),
                    social_links: uniqueValues(inspected.flatMap((page) => page.social_links ?? [])).slice(0, 8),
                    profile_links: uniqueValues(inspected.flatMap((page) => page.profile_links ?? [])).slice(0, 8),
                },
                rawPayload: { inspected },
            })
        }
        if (ownerName && ownerPhone) {
            await recordEvidenceClaim({
                workspaceId,
                pollId,
                companyId,
                sourceKey: "website",
                claimKind: "owner_phone",
                pointsAwarded: 2,
                confidence: Math.max(74, ownerConfidence ?? 0),
                provenanceUrl: ownerSourceUrl ?? websiteUrl,
                claimValue: { owner_name: ownerName, owner_phone: ownerPhone, role: ownerRole, source_url: ownerSourceUrl },
                rawPayload: { inspected },
            })
        }
        await updateInvestigationTask({
            workspaceId,
            pollId,
            companyId,
            sourceKey: "website",
            stageKey,
            status: "completed",
            matched: Boolean(ownerName || ownerPhone || businessPhone),
            ownerIdentityPoints: ownerName ? 2 : 0,
            ownerPhonePoints: ownerName && ownerPhone ? 2 : 0,
            businessSupportPoints: businessPhone || inspected.length ? 1 : 0,
            rawPayload: { inspected },
        })
        await updateInvestigationTask({
            workspaceId,
            pollId,
            companyId,
            sourceKey: "web.json_ld",
            stageKey,
            status: "completed",
            matched: inspected.some((page) => page.evidence.includes("json_ld_present")),
            businessSupportPoints: inspected.some((page) => page.evidence.includes("json_ld_present")) ? 1 : 0,
            rawPayload: { inspected },
        })
    }
    if (ownerName || ownerPhone || businessPhone) {
        const updatePayload: Record<string, unknown> = {
            last_seen_at: new Date().toISOString(),
        }
        if (ownerName && ownerPhone) {
            updatePayload.owner_name = ownerName
            updatePayload.owner_source_key = "website"
            updatePayload.owner_evidence = { source: "website", owner_role: ownerRole, owner_source_url: ownerSourceUrl, inspected, extracted_at: new Date().toISOString() }
            updatePayload.owner_phone = ownerPhone
            updatePayload.owner_confidence = Math.max(74, ownerConfidence ?? 0)
        }
        if (businessPhone) updatePayload.phone = businessPhone
        const { error } = await supabaseAdmin
            .from("leadgen_companies")
            .update(updatePayload)
            .eq("id", companyId)
        if (error) throw error
    }
    return { rawCount: inspected.length, companyCount: ownerName || ownerPhone || businessPhone ? 1 : 0 }
}

async function cancelStaleWebsiteTasks(workspaceId: string, pollId: string, stageKey?: PollStageKey) {
    const staleStartedBefore = new Date(Date.now() - WEBSITE_STALE_TASK_MS).toISOString()
    let staleTasksQuery = supabaseAdmin
        .from("leadgen_poll_tasks")
        .select("id, stage_key, source_query")
        .eq("poll_id", pollId)
        .eq("workspace_id", workspaceId)
        .eq("source_key", "website")
        .eq("status", "running")
        .lt("started_at", staleStartedBefore)
    if (stageKey) staleTasksQuery = staleTasksQuery.eq("stage_key", stageKey)
    const staleTasksResult = await staleTasksQuery
    if (staleTasksResult.error) throw new Error(`Could not inspect stale website tasks: ${staleTasksResult.error.message}`)
    const staleTasks = (staleTasksResult.data ?? []) as Array<{ id: string; stage_key: PollStageKey; source_query: Record<string, unknown> | null }>
    if (staleTasks.length === 0) return
    const message = "Website crawl exceeded the per-candidate runtime budget and was cancelled so the staged poll can continue."
    const staleTaskIds = staleTasks.map((task) => task.id)
    const { error } = await supabaseAdmin
        .from("leadgen_poll_tasks")
        .update({ status: "cancelled", completed_at: new Date().toISOString(), error: message })
        .in("id", staleTaskIds)
    if (error) throw new Error(`Could not cancel stale website tasks: ${error.message}`)
    for (const task of staleTasks) {
        const companyId = typeof task.source_query?.company_id === "string" ? task.source_query.company_id : null
        if (!companyId) continue
        const taskStageKey = task.stage_key === "seed" ? "business_validation" : task.stage_key
        await updateInvestigationTask({ workspaceId, pollId, companyId, sourceKey: "website", stageKey: taskStageKey, status: "skipped", skipReason: message, rawPayload: task.source_query ?? {} })
        await updateInvestigationTask({ workspaceId, pollId, companyId, sourceKey: "web.json_ld", stageKey: taskStageKey, status: "skipped", skipReason: message, rawPayload: task.source_query ?? {} })
    }
}

export async function processPipelineSourcePoll(pollId: string, workspaceId: string, sourceKey: LeadgenSourceKey, options: { finalize?: boolean; stageKey?: PollStageKey } = {}) {
    await setLeadgenPollStatus(pollId, workspaceId, "running")
    if (sourceKey === "website") await cancelStaleWebsiteTasks(workspaceId, pollId, options.stageKey)
    let tasksQuery = supabaseAdmin
        .from("leadgen_poll_tasks")
        .select("id, source_key, stage_key, source_query, industry_value, location_value")
        .eq("poll_id", pollId)
        .eq("workspace_id", workspaceId)
        .eq("source_key", sourceKey)
        .eq("status", "queued")
        .order("created_at", { ascending: true })
    if (options.stageKey) tasksQuery = tasksQuery.eq("stage_key", options.stageKey)
    const tasksResult = await tasksQuery
    if (tasksResult.error) {
        await setLeadgenPollStatus(pollId, workspaceId, "failed", `Could not load ${sourceKey} tasks: ${tasksResult.error.message}`, true)
        return
    }
    const tasks = (tasksResult.data ?? []) as PipelineTask[]
    const failWebsiteInvestigationRows = async (task: PipelineTask, message: string) => {
        const companyId = typeof task.source_query?.company_id === "string" ? task.source_query.company_id : null
        if (sourceKey !== "website" || !companyId) return
        const query = { ...(task.source_query ?? {}), workspace_id: workspaceId, poll_id: pollId }
        const stageKey = task.stage_key === "seed" ? "business_validation" : task.stage_key
        await updateInvestigationTask({
            workspaceId,
            pollId,
            companyId,
            sourceKey: "website",
            stageKey,
            status: "failed",
            error: message,
            rawPayload: query,
        })
        await updateInvestigationTask({
            workspaceId,
            pollId,
            companyId,
            sourceKey: "web.json_ld",
            stageKey,
            status: "failed",
            error: message,
            rawPayload: query,
        })
    }
    const processTask = async (task: PipelineTask) => {
        await supabaseAdmin.from("leadgen_poll_tasks").update({ status: "running", started_at: new Date().toISOString(), error: null }).eq("id", task.id)
        try {
            const query = { ...(task.source_query ?? {}), workspace_id: workspaceId, poll_id: pollId }
            const taskWithWorkspace = { ...task, source_query: query }
            const result = sourceKey === "website"
                ? await processWebsiteTask(taskWithWorkspace)
                : sourceKey === "sam_gov"
                    ? await processSamGovTask(taskWithWorkspace)
                    : sourceKey === "overture"
                        ? await processOvertureTask(taskWithWorkspace)
                        : sourceKey === "alltheplaces" || sourceKey === "foursquare_os_places"
                            ? await processPlaceSeedTask(taskWithWorkspace, sourceKey)
                        : await processBlockedExternalTask()
            await supabaseAdmin
                .from("leadgen_poll_tasks")
                .update({ status: "completed", raw_count: result?.rawCount ?? 0, company_count: result?.companyCount ?? 0, completed_at: new Date().toISOString(), error: null })
                .eq("id", task.id)
        } catch (error) {
            const message = compactErrorMessage(error)
            await failWebsiteInvestigationRows(task, message)
            if (error instanceof SamGovQuotaError) {
                await supabaseAdmin
                    .from("leadgen_poll_tasks")
                    .update({ status: "failed", completed_at: new Date().toISOString(), error: message })
                    .eq("id", task.id)
                throw error
            }
            await supabaseAdmin
                .from("leadgen_poll_tasks")
                .update({ status: "failed", completed_at: new Date().toISOString(), error: compactErrorMessage(error) })
                .eq("id", task.id)
        }
    }
    if (sourceKey === "sam_gov") {
        for (const [index, task] of tasks.entries()) {
            try {
                await processTask(task)
            } catch (error) {
                if (!(error instanceof SamGovQuotaError)) throw error
                const message = compactErrorMessage(error)
                const remainingTaskIds = tasks.slice(index + 1).map((remainingTask) => remainingTask.id)
                if (remainingTaskIds.length) {
                    await supabaseAdmin
                        .from("leadgen_poll_tasks")
                        .update({ status: "failed", completed_at: new Date().toISOString(), error: `Skipped because ${message}` })
                        .in("id", remainingTaskIds)
                }
                break
            }
        }
    } else {
        const stageKey = options.stageKey === "seed" ? "business_validation" : options.stageKey
        const concurrency = sourceKey === "website"
            ? WEBSITE_TASK_CONCURRENCY[stageKey ?? "owner_identity"]
            : 1
        await runWithConcurrency(tasks, concurrency, async (task) => {
            await processTask(task)
        })
    }
    await refreshLeadgenPollCounts(pollId, workspaceId)
    if (options.finalize !== false) await refreshLeadgenPollCounts(pollId, workspaceId)
}
