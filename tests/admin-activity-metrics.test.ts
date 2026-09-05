import assert from "node:assert/strict"
import test from "node:test"
import { ACTIVITY_RANGES, formatActivityCount, buildAdminActivityMetrics } from "../lib/admin/activity-metrics.ts"
import { sanitizeAdminActivityPayload } from "../lib/admin/activity-sanitizer.ts"
import type { AdminActivityEvent } from "../lib/admin/activity.ts"

function event(id: string, occurredAt: string, overrides: Partial<AdminActivityEvent> = {}): AdminActivityEvent {
    return {
        id,
        category: "system",
        level: "info",
        event_key: `request.${id}`,
        summary: id,
        entity_type: null,
        entity_id: null,
        source_href: null,
        actor_user_id: null,
        metadata: {},
        occurred_at: occurredAt,
        created_at: occurredAt,
        ...overrides,
    }
}

test("Activity graphs use rolling hourly buckets and totals for the entire period", () => {
    const metrics = buildAdminActivityMetrics([
        event("request", "2026-08-09T12:05:00.000Z", { event_key: "workspace.mutation.completed", metric_classification: "operational" }),
        event("outbound", "2026-08-09T12:10:00.000Z", { category: "billing", metric_classification: "internal_call" }),
        event("inbound", "2026-08-09T12:15:00.000Z", { category: "communications", metric_classification: "external_call" }),
        event("error", "2026-08-09T12:20:00.000Z", { category: "integrations", event_key: "workspace.mutation.failed", level: "error", outcome: "failed", metric_classification: "operational", metadata: { status: 200 } }),
        event("other-operational", "2026-08-09T12:22:00.000Z", { metric_classification: "operational" }),
        event("historic-webhook", "2026-08-09T11:20:00.000Z", { category: "billing", event_key: "stripe.webhook.received", metric_classification: "external_call" }),
        event("audit", "2026-08-09T12:25:00.000Z", { metric_classification: "audit" }),
        event("too-old", "2026-08-08T12:20:00.000Z"),
    ], new Date("2026-08-09T12:30:00.000Z"))

    assert.deepEqual(metrics.map((metric) => metric.title), ["Requests", "Internal Calls", "External Calls", "Error rate"])
    assert.ok(metrics.every((metric) => metric.points.length === 24))
    assert.equal(metrics.find((metric) => metric.key === "requests")?.currentValue, 2)
    assert.equal(metrics.find((metric) => metric.key === "internal_calls")?.currentValue, 1)
    assert.equal(metrics.find((metric) => metric.key === "external_calls")?.currentValue, 2)
    assert.equal(metrics.find((metric) => metric.key === "external_calls")?.points.at(-2)?.value, 1)
    assert.equal(metrics.find((metric) => metric.key === "error_rate")?.currentValue, 20)
    assert.equal(metrics.find((metric) => metric.key === "error_rate")?.tone, "red")
})

test("Activity diagnostics redact credentials and client contact data while retaining safe identifiers", () => {
    const sanitized = sanitizeAdminActivityPayload({
        error_code: "WHATSAPP_RATE_LIMIT",
        composition_hash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        authorization: "Bearer top-secret-token",
        payload: { answer: "private answer" },
        error_summary: "Authorization: Bearer abc123 token=secret-value contact person@example.com or +353 89 123 4567",
        nested: ["password=hunter2", { client_secret: "never-store-this" }],
    }) as Record<string, unknown>
    const encoded = JSON.stringify(sanitized)

    assert.equal(sanitized.error_code, "WHATSAPP_RATE_LIMIT")
    assert.equal(sanitized.composition_hash, "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
    assert.doesNotMatch(encoded, /top-secret|private answer|secret-value|person@example|353 89|hunter2|never-store/u)
    assert.match(encoded, /REDACTED/u)
})


test("Every range includes its exact start and now, excludes older and future events, and weights error rates", () => {
    const now = new Date("2026-09-06T12:30:00Z")
    for (const range of Object.keys(ACTIVITY_RANGES) as (keyof typeof ACTIVITY_RANGES)[]) {
        const config = ACTIVITY_RANGES[range]
        const start = now.getTime() - config.hours * 3600000
        const call = (id: string, time: number, failed = false) => event(id, new Date(time).toISOString(), { metric_classification: "internal_call", outcome: failed ? "failed" : "succeeded" })
        const metrics = buildAdminActivityMetrics([call("start", start, true), call("now", now.getTime()), call("recent", now.getTime() - 1), call("old", start - 1), call("future", now.getTime() + 1)], now, range)
        assert.equal(metrics[1].points.length, config.buckets)
        assert.equal(metrics[1].currentValue, 3)
        assert.equal(metrics[1].points[0].value, 1)
        assert.equal(metrics[1].points.at(-1)?.value, 2)
        assert.equal(metrics[3].currentValue, (1 / 3) * 100)
        assert.equal(buildAdminActivityMetrics([], now, range)[3].currentValue, 0)
    }
})

test("Activity counts use compact notation", () => {
    assert.equal(formatActivityCount(14235), "14.2k")
    assert.equal(formatActivityCount(1234567), "1.2m")
    assert.equal(formatActivityCount(0), "0")
    assert.equal(formatActivityCount(999), "999")
})
