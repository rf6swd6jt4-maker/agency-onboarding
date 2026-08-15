import assert from "node:assert/strict"
import test from "node:test"
import { buildAdminActivityMetrics } from "../lib/admin/activity-metrics.ts"
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

test("Activity graphs use rolling hourly buckets and the current hour updates from the log", () => {
    const metrics = buildAdminActivityMetrics([
        event("request", "2026-08-09T12:05:00.000Z", { event_key: "workspace.mutation.completed", metric_classification: "operational" }),
        event("outbound", "2026-08-09T12:10:00.000Z", { category: "billing", metric_classification: "internal_call" }),
        event("inbound", "2026-08-09T12:15:00.000Z", { category: "communications", metric_classification: "external_call" }),
        event("error", "2026-08-09T12:20:00.000Z", { category: "integrations", event_key: "workspace.mutation.failed", level: "error", outcome: "failed", metric_classification: "operational" }),
        event("other-operational", "2026-08-09T12:22:00.000Z", { category: "integrations", metric_classification: "operational" }),
        event("historic-webhook", "2026-08-09T11:20:00.000Z", { category: "billing", event_key: "stripe.webhook.received", metric_classification: "external_call" }),
        event("audit", "2026-08-09T12:25:00.000Z", { metric_classification: "audit" }),
        event("too-old", "2026-08-08T12:20:00.000Z"),
    ], new Date("2026-08-09T12:30:00.000Z"))

    assert.deepEqual(metrics.map((metric) => metric.title), ["Requests", "Calls", "Error rate"])
    assert.ok(metrics.every((metric) => metric.points.length === 24))
    assert.equal(metrics.find((metric) => metric.key === "requests")?.currentValue, 2)
    assert.equal(metrics.find((metric) => metric.key === "calls")?.currentValue, 1)
    assert.equal(metrics.find((metric) => metric.key === "calls")?.points.at(-2)?.value, 1)
    assert.ok(Math.abs((metrics.find((metric) => metric.key === "error_rate")?.currentValue ?? 0) - (100 / 3)) < 0.001)
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
