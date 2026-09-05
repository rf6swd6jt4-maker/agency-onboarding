import type { AdminActivityEvent } from "@/lib/admin/activity"

export type AdminActivityMetricKey = "requests" | "internal_calls" | "external_calls" | "error_rate"

export type AdminActivityMetricPoint = {
    startsAt: string
    value: number
}

export type AdminActivityMetric = {
    key: AdminActivityMetricKey
    title: string
    description: string
    currentValue: number
    points: AdminActivityMetricPoint[]
    tone: "neutral" | "red"
    unit: "count" | "percentage"
}

export const ACTIVITY_RANGES = {
    "30d": { label: "Last 30 days", hours: 720, buckets: 30, bucketLabel: "Daily" },
    "7d": { label: "Last 7 days", hours: 168, buckets: 168, bucketLabel: "Hourly" },
    "24h": { label: "Last 24h", hours: 24, buckets: 24, bucketLabel: "Hourly" },
    "1h": { label: "Last hour", hours: 1, buckets: 60, bucketLabel: "Minute" },
} as const
export type AdminActivityRange = keyof typeof ACTIVITY_RANGES

export function formatActivityCount(value: number) {
    return new Intl.NumberFormat("en-IE", { notation: "compact", maximumFractionDigits: 1 }).format(value).toLowerCase()
}

function metricClassification(event: AdminActivityEvent) {
    if (event.metric_classification) return event.metric_classification
    const legacyDirection = event.metadata?.request_direction
    if (legacyDirection === "outbound") return "internal_call" as const
    if (legacyDirection === "inbound") return "external_call" as const
    return "audit" as const
}

export function buildAdminActivityMetrics(events: AdminActivityEvent[], now = new Date(), range: AdminActivityRange = "24h"): AdminActivityMetric[] {
    const config = ACTIVITY_RANGES[range]
    const firstTime = now.getTime() - config.hours * 60 * 60 * 1000
    const bucketMs = config.hours * 60 * 60 * 1000 / config.buckets
    const buckets = Array.from({ length: config.buckets }, (_, index) => ({
        startsAt: new Date(firstTime + index * bucketMs).toISOString(),
        requests: 0,
        internalCalls: 0,
        externalCalls: 0,
        errors: 0,
    }))

    for (const event of events) {
        const occurredAt = new Date(event.occurred_at).getTime()
        if (!Number.isFinite(occurredAt) || occurredAt < firstTime || occurredAt > now.getTime()) continue
        const bucketIndex = Math.min(buckets.length - 1, Math.floor((occurredAt - firstTime) / bucketMs))
        if (bucketIndex < 0 || bucketIndex >= buckets.length) continue
        const bucket = buckets[bucketIndex]
        const classification = metricClassification(event)
        const mutationRequest = classification === "operational" && event.event_key.startsWith("workspace.mutation.")
        const internalCall = classification === "internal_call"
        const externalCall = classification === "external_call"
        if (!mutationRequest && !internalCall && !externalCall) continue
        if (mutationRequest) bucket.requests += 1
        if (internalCall) bucket.internalCalls += 1
        if (externalCall) bucket.externalCalls += 1
        if (event.outcome === "failed" || event.level === "error") bucket.errors += 1
    }

    const totals = buckets.reduce((total, bucket) => ({ startsAt: "", requests: total.requests + bucket.requests, internalCalls: total.internalCalls + bucket.internalCalls, externalCalls: total.externalCalls + bucket.externalCalls, errors: total.errors + bucket.errors }), { startsAt: "", requests: 0, internalCalls: 0, externalCalls: 0, errors: 0 })

    const metric = (
        key: AdminActivityMetricKey,
        title: string,
        description: string,
        tone: "neutral" | "red",
        unit: "count" | "percentage",
        value: (bucket: (typeof buckets)[number]) => number,
    ): AdminActivityMetric => {
        const points = buckets.map((bucket) => ({ startsAt: bucket.startsAt, value: value(bucket) }))
        return { key, title, description, tone, unit, points, currentValue: value(totals) }
    }

    return [
        metric("requests", "Requests", "Workspace mutation requests.", "neutral", "count", (bucket) => bucket.requests),
        metric("internal_calls", "Internal Calls", "Calls from Betelgeze to another platform.", "neutral", "count", (bucket) => bucket.internalCalls),
        metric("external_calls", "External Calls", "Calls from another platform into Betelgeze.", "neutral", "count", (bucket) => bucket.externalCalls),
        metric("error_rate", "Error rate", "Failures across mutation requests, internal calls, and external calls.", "red", "percentage", (bucket) => {
            const total = bucket.requests + bucket.internalCalls + bucket.externalCalls
            return total ? (bucket.errors / total) * 100 : 0
        }),
    ]
}
