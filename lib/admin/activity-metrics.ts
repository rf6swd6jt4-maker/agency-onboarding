import type { AdminActivityEvent } from "@/lib/admin/activity"

export type AdminActivityMetricKey = "requests" | "internal_calls" | "external_calls" | "error_rate"

export type AdminActivityMetricPoint = {
    startsAt: string
    value: number | null
    samples: number
    failures: number
    rawValue: number
}

export type AdminActivityMetric = {
    key: AdminActivityMetricKey
    title: string
    description: string
    currentValue: number | null
    points: AdminActivityMetricPoint[]
    tone: "neutral" | "red"
    unit: "count" | "percentage"
}

export const ACTIVITY_RANGES = {
    "30d": { label: "Last 30 days", hours: 720, buckets: 60, bucketLabel: "12-hour", smoothing: "36-hour", errorWindow: "3-day" },
    "7d": { label: "Last 7 days", hours: 168, buckets: 56, bucketLabel: "3-hour", smoothing: "9-hour", errorWindow: "18-hour" },
    "24h": { label: "Last 24h", hours: 24, buckets: 48, bucketLabel: "30-minute", smoothing: "90-minute", errorWindow: "3-hour" },
    "1h": { label: "Last hour", hours: 1, buckets: 30, bucketLabel: "2-minute", smoothing: "6-minute", errorWindow: "12-minute" },
} as const
export const ACTIVITY_ERROR_WINDOW_BUCKETS = 6
export type AdminActivityMetricEvent = Pick<AdminActivityEvent, "occurred_at" | "event_key" | "metric_classification" | "outcome" | "level" | "metadata">
export type AdminActivityMetricBundle = Record<AdminActivityRange, AdminActivityMetric[]>

export function buildAdminActivityMetricBundle(events: AdminActivityMetricEvent[], now = new Date()): AdminActivityMetricBundle {
    return Object.fromEntries((Object.keys(ACTIVITY_RANGES) as AdminActivityRange[]).map((range) => [range, buildAdminActivityMetrics(events, now, range)])) as AdminActivityMetricBundle
}

export type AdminActivityRange = keyof typeof ACTIVITY_RANGES

export function formatActivityCount(value: number) {
    return new Intl.NumberFormat("en-IE", { notation: "compact", maximumFractionDigits: 1 }).format(value).toLowerCase()
}

function metricClassification(event: AdminActivityMetricEvent) {
    if (event.metric_classification) return event.metric_classification
    const legacyDirection = event.metadata?.request_direction
    if (legacyDirection === "outbound") return "internal_call" as const
    if (legacyDirection === "inbound") return "external_call" as const
    return "audit" as const
}

export function buildAdminActivityMetrics(events: AdminActivityMetricEvent[], now = new Date(), range: AdminActivityRange = "24h"): AdminActivityMetric[] {
    const config = ACTIVITY_RANGES[range]
    const firstTime = now.getTime() - config.hours * 60 * 60 * 1000
    const bucketMs = config.hours * 60 * 60 * 1000 / config.buckets
    // Warm up the rolling window with earlier events, without adding them to period totals.
    const warmup = ACTIVITY_ERROR_WINDOW_BUCKETS - 1
    const bucketStart = firstTime - warmup * bucketMs
    const buckets = Array.from({ length: config.buckets + warmup }, (_, index) => ({
        startsAt: new Date(bucketStart + index * bucketMs).toISOString(),
        requests: 0,
        internalCalls: 0,
        externalCalls: 0,
        errors: 0,
        completed: 0,
    }))

    for (const event of events) {
        const occurredAt = new Date(event.occurred_at).getTime()
        if (!Number.isFinite(occurredAt) || occurredAt < bucketStart || occurredAt > now.getTime()) continue
        const bucketIndex = Math.min(buckets.length - 1, Math.floor((occurredAt - bucketStart) / bucketMs))
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
        // Cancelled, queued and rejected operations are not completed attempts.
        const failed = event.outcome === "failed" || (!event.outcome && event.level === "error")
        const succeeded = event.outcome === "succeeded" || (!event.outcome && event.level !== "error")
        if (failed || succeeded) bucket.completed += 1
        if (failed) bucket.errors += 1
    }

    type Bucket = (typeof buckets)[number]
    const sum = (items: Bucket[]) => items.reduce((total, bucket) => ({
        startsAt: "", requests: total.requests + bucket.requests,
        internalCalls: total.internalCalls + bucket.internalCalls,
        externalCalls: total.externalCalls + bucket.externalCalls,
        errors: total.errors + bucket.errors, completed: total.completed + bucket.completed,
    }), { startsAt: "", requests: 0, internalCalls: 0, externalCalls: 0, errors: 0, completed: 0 })
    const totals = sum(buckets.slice(warmup))
    const metric = (
        key: AdminActivityMetricKey, title: string, description: string,
        field: "requests" | "internalCalls" | "externalCalls" | "errors",
    ): AdminActivityMetric => {
        const errorRate = key === "error_rate"
        const points = buckets.slice(warmup).map((bucket, index) => {
            const end = index + warmup + 1
            const window = buckets.slice(end - (errorRate ? ACTIVITY_ERROR_WINDOW_BUCKETS : 3), end)
            const total = sum(window)
            return {
                startsAt: new Date(new Date(bucket.startsAt).getTime() + bucketMs).toISOString(),
                value: errorRate ? (total.completed ? total.errors / total.completed * 100 : null) : total[field] / window.length,
                rawValue: bucket[field], samples: total.completed, failures: total.errors,
            }
        })
        return {
            key, title, description, points, tone: errorRate ? "red" : "neutral", unit: errorRate ? "percentage" : "count",
            currentValue: errorRate ? (totals.completed ? totals.errors / totals.completed * 100 : null) : totals[field],
        }
    }
    return [
        metric("requests", "Requests", "Workspace mutation requests.", "requests"),
        metric("internal_calls", "Internal Calls", "Calls from Betelgeze to another platform.", "internalCalls"),
        metric("external_calls", "External Calls", "Calls from another platform into Betelgeze.", "externalCalls"),
        metric("error_rate", "Error rate", "Failures across completed requests and calls.", "errors"),
    ]
}
