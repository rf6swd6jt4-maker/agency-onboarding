import assert from "node:assert/strict"
import test from "node:test"
import { buildAdminActivityMetrics } from "../lib/admin/activity-metrics.ts"
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

test("Activity graphs use rolling hourly buckets and the current hour updates from the log", () => {
    const metrics = buildAdminActivityMetrics([
        event("request", "2026-08-09T12:05:00.000Z"),
        event("outbound", "2026-08-09T12:10:00.000Z", { category: "billing", metadata: { request_direction: "outbound" } }),
        event("inbound", "2026-08-09T12:15:00.000Z", { category: "communications", metadata: { request_direction: "inbound" } }),
        event("error", "2026-08-09T12:20:00.000Z", { category: "integrations", level: "error" }),
        event("historic-webhook", "2026-08-09T11:20:00.000Z", { category: "billing", event_key: "stripe.webhook.received" }),
        event("too-old", "2026-08-08T12:20:00.000Z"),
    ], new Date("2026-08-09T12:30:00.000Z"))

    assert.deepEqual(metrics.map((metric) => metric.title), ["Requests", "Internal Calls", "External Calls", "Error rate"])
    assert.ok(metrics.every((metric) => metric.points.length === 24))
    assert.equal(metrics.find((metric) => metric.key === "requests")?.currentValue, 4)
    assert.equal(metrics.find((metric) => metric.key === "internal_calls")?.currentValue, 2)
    assert.equal(metrics.find((metric) => metric.key === "external_calls")?.currentValue, 1)
    assert.equal(metrics.find((metric) => metric.key === "external_calls")?.points.at(-2)?.value, 1)
    assert.equal(metrics.find((metric) => metric.key === "error_rate")?.currentValue, 25)
    assert.equal(metrics.find((metric) => metric.key === "error_rate")?.tone, "red")
})
