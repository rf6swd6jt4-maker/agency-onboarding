import type { AdminActivityEvent } from "@/lib/admin/activity"

export type AdminActivityMetricKey = "requests" | "calls" | "error_rate"

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

const TREND_HOURS = 24

function metricClassification(event: AdminActivityEvent) {
    if (event.metric_classification) return event.metric_classification
    const legacyDirection = event.metadata?.request_direction
    if (legacyDirection === "outbound") return "internal_call" as const
    if (legacyDirection === "inbound") return "external_call" as const
    return "audit" as const
}

function startOfHour(value: Date) {
    const result = new Date(value)
    result.setUTCMinutes(0, 0, 0)
    return result
}

export function buildAdminActivityMetrics(events: AdminActivityEvent[], now = new Date()): AdminActivityMetric[] {
    const currentHour = startOfHour(now)
    const firstHour = new Date(currentHour.getTime() - (TREND_HOURS - 1) * 60 * 60 * 1000)
    const buckets = Array.from({ length: TREND_HOURS }, (_, index) => ({
        startsAt: new Date(firstHour.getTime() + index * 60 * 60 * 1000).toISOString(),
        requests: 0,
        calls: 0,
        errors: 0,
    }))

    for (const event of events) {
        const occurredAt = new Date(event.occurred_at).getTime()
        if (!Number.isFinite(occurredAt)) continue
        const bucketIndex = Math.floor((occurredAt - firstHour.getTime()) / (60 * 60 * 1000))
        if (bucketIndex < 0 || bucketIndex >= buckets.length) continue
        const bucket = buckets[bucketIndex]
        const classification = metricClassification(event)
        const request = classification === "operational" && event.event_key.startsWith("workspace.mutation.")
        const call = classification === "external_call"
        if (!request && !call) continue
        if (request) bucket.requests += 1
        if (call) bucket.calls += 1
        if (event.outcome === "failed" || event.level === "error") bucket.errors += 1
    }

    const metric = (
        key: AdminActivityMetricKey,
        title: string,
        description: string,
        tone: "neutral" | "red",
        unit: "count" | "percentage",
        value: (bucket: (typeof buckets)[number]) => number,
    ): AdminActivityMetric => {
        const points = buckets.map((bucket) => ({ startsAt: bucket.startsAt, value: value(bucket) }))
        return { key, title, description, tone, unit, points, currentValue: points.at(-1)?.value ?? 0 }
    }

    return [
        metric("requests", "Requests", "Workspace mutation requests.", "neutral", "count", (bucket) => bucket.requests),
        metric("calls", "Calls", "Webhook calls received from connected platforms.", "neutral", "count", (bucket) => bucket.calls),
        metric("error_rate", "Error rate", "Errors across mutation requests and webhook calls.", "red", "percentage", (bucket) => bucket.requests + bucket.calls ? (bucket.errors / (bucket.requests + bucket.calls)) * 100 : 0),
    ]
}
