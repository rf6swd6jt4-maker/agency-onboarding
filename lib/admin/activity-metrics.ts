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

const TREND_HOURS = 24

function requestDirection(event: AdminActivityEvent): "outbound" | "inbound" | null {
    const explicitDirection = event.metadata?.request_direction
    if (explicitDirection === "outbound" || explicitDirection === "inbound") return explicitDirection

    if (event.event_key.includes("webhook.received")) return "inbound"
    if (event.event_key.startsWith("whatsapp.message.") && typeof event.metadata?.status === "string") return "inbound"
    if (event.event_key.startsWith("whatsapp.") && event.event_key.endsWith(".sent")) return "outbound"
    if (event.event_key.startsWith("clickup.")) return "outbound"
    if (event.event_key.startsWith("r2.")) return "outbound"
    if (event.event_key.startsWith("stripe.") && event.event_key.endsWith(".sent")) return "outbound"
    if (event.level === "error" && ["billing", "communications", "integrations", "leadgen"].includes(event.category)) return "outbound"
    return null
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
        internalCalls: 0,
        externalCalls: 0,
        errors: 0,
    }))

    for (const event of events) {
        const occurredAt = new Date(event.occurred_at).getTime()
        if (!Number.isFinite(occurredAt)) continue
        const bucketIndex = Math.floor((occurredAt - firstHour.getTime()) / (60 * 60 * 1000))
        if (bucketIndex < 0 || bucketIndex >= buckets.length) continue
        const bucket = buckets[bucketIndex]
        bucket.requests += 1
        if (event.level === "error") bucket.errors += 1
        const direction = requestDirection(event)
        if (direction === "outbound") bucket.internalCalls += 1
        if (direction === "inbound") bucket.externalCalls += 1
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
        metric("requests", "Requests", "Recorded actions that could generate an error.", "neutral", "count", (bucket) => bucket.requests),
        metric("internal_calls", "Internal Calls", "Calls from Betelgeze to another platform.", "neutral", "count", (bucket) => bucket.internalCalls),
        metric("external_calls", "External Calls", "Calls from another platform into Betelgeze.", "neutral", "count", (bucket) => bucket.externalCalls),
        metric("error_rate", "Error rate", "Errors in the activity log as a share of requests.", "red", "percentage", (bucket) => bucket.requests ? (bucket.errors / bucket.requests) * 100 : 0),
    ]
}
