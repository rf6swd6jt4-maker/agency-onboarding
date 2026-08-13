import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import type { OnboardingServiceDefinition } from "../lib/onboarding/configuration-types.ts"
import { SERVICES } from "../lib/onboarding/services.ts"
import {
    buildRelationshipDealServiceOptionsCore,
    relationshipFulfilmentServiceDefinitionCore,
    relationshipServiceDisplayNameCore,
    type OnboardingServiceRevisionDisplay,
} from "../lib/onboarding/service-display-core.ts"

const buildRelationshipDealServiceOptions = (input: Parameters<typeof buildRelationshipDealServiceOptionsCore>[0]) => buildRelationshipDealServiceOptionsCore(input, SERVICES)
const relationshipFulfilmentServiceDefinition = (serviceKey: string, name?: string | null) => relationshipFulfilmentServiceDefinitionCore(serviceKey, name, SERVICES)
const relationshipServiceDisplayName = (service: Parameters<typeof relationshipServiceDisplayNameCore>[0], revisions: Parameters<typeof relationshipServiceDisplayNameCore>[1]) => relationshipServiceDisplayNameCore(service, revisions, SERVICES)

function service(overrides: Partial<OnboardingServiceDefinition> = {}): OnboardingServiceDefinition {
    return {
        id: "11111111-1111-4111-8111-111111111111",
        revisionId: "22222222-2222-4222-8222-222222222222",
        code: "custom-service",
        name: "Current custom service",
        description: "Current description",
        state: "active",
        version: 3,
        isTest: true,
        defaultPriceCents: 125_00,
        currency: "USD",
        defaultAssigneeId: null,
        displayPriority: 20,
        modules: [],
        archiveBlockers: [],
        lastEditedAt: null,
        ...overrides,
    }
}

test("deal catalogue exposes Active services and keeps selected retired revisions", () => {
    const active = service()
    const retired = service({
        id: "33333333-3333-4333-8333-333333333333",
        revisionId: "44444444-4444-4444-8444-444444444444",
        code: "retired-service",
        name: "Current retired name",
        state: "retired",
        isTest: false,
    })
    const frozenRevision: OnboardingServiceRevisionDisplay = {
        id: "55555555-5555-4555-8555-555555555555",
        serviceId: retired.id,
        revisionNumber: 1,
        name: "Original purchased name",
        description: "Original revision",
        defaultPriceCents: 90_00,
        currency: "EUR",
        isTest: false,
    }
    const selected = [{
        service_key: retired.code,
        service_id: retired.id,
        service_revision_id: frozenRevision.id,
        price_cents: 85_00,
        currency: "EUR",
        assignee_user_id: null,
    }]
    const options = buildRelationshipDealServiceOptions({
        schemaReady: true,
        services: [active, retired],
        selected,
        revisions: new Map([[frozenRevision.id, frozenRevision]]),
    })
    assert.deepEqual(options.map((option) => option.code).sort(), ["custom-service", "retired-service"])
    const retained = options.find((option) => option.code === retired.code)
    assert.equal(retained?.name, "Original purchased name")
    assert.equal(retained?.revisionId, frozenRevision.id)
    assert.equal(retained?.selected?.price_cents, 85_00)
})

test("deal catalogue excludes unselected Retired services", () => {
    const options = buildRelationshipDealServiceOptions({
        schemaReady: true,
        services: [service({ state: "retired" })],
        selected: [],
        revisions: new Map(),
    })
    assert.deepEqual(options, [])
})

test("schema-unavailable workspaces retain the legacy catalogue fallback", () => {
    const options = buildRelationshipDealServiceOptions({ schemaReady: false, services: [], selected: [], revisions: new Map() })
    assert.ok(options.some((option) => option.code === "google-ads" && option.state === "legacy"))
})

test("relationship labels prefer the frozen revision and retain legacy keys", () => {
    const revision: OnboardingServiceRevisionDisplay = {
        id: "66666666-6666-4666-8666-666666666666",
        serviceId: "77777777-7777-4777-8777-777777777777",
        revisionNumber: 2,
        name: "Frozen service name",
        description: "",
        defaultPriceCents: 0,
        currency: "USD",
        isTest: false,
    }
    assert.equal(relationshipServiceDisplayName({ service_key: "renamed", service_revision_id: revision.id }, new Map([[revision.id, revision]])), "Frozen service name")
    assert.equal(relationshipServiceDisplayName({ service_key: "google-ads", service_revision_id: null }, new Map()), "Google Search Ads")
    assert.equal(relationshipServiceDisplayName({ service_key: "unknown-legacy", service_revision_id: null }, new Map()), "unknown-legacy")
})

test("fulfilment uses immutable revision names while preserving legacy SOPs and a safe custom fallback", () => {
    const legacy = relationshipFulfilmentServiceDefinition("seo", "Purchased Search Programme")
    assert.equal(legacy.name, "Purchased Search Programme")
    assert.ok(legacy.steps.length > 1)

    const custom = relationshipFulfilmentServiceDefinition("generated-custom-code", "Executive Reporting")
    assert.equal(custom.name, "Executive Reporting")
    assert.deepEqual(custom.steps, [{
        key: "complete",
        title: "Complete Executive Reporting",
        description: "Complete this service's delivery work.",
    }])
})

test("commercial save persists exact identities, negotiated currency, and sent-sale guards", () => {
    const actions = readFileSync("app/[workspaceSlug]/relationships/actions.ts", "utf8")
    const detail = readFileSync("app/[workspaceSlug]/relationships/[relationshipId]/page.tsx", "utf8")
    assert.match(actions, /service_id: serviceId, service_revision_id: serviceRevisionId/)
    assert.match(actions, /service_currency_/)
    assert.match(actions, /Void and replace the sent invoice before changing services or negotiated prices/)
    assert.match(actions, /catalogue\.state !== "active"/)
    assert.match(actions, /rpc\("save_relationship_commercial_configuration"/)
    assert.match(actions, /p_services: versionedRows/)
    assert.match(detail, /loadPublishedOnboardingConfiguration/)
    assert.match(detail, /buildRelationshipDealServiceOptions/)
    assert.doesNotMatch(detail, /Object\.entries\(SERVICES\)/)
})

test("relationship invoicing uses the visible details workspace and three-stage review", () => {
    const detail = readFileSync("app/[workspaceSlug]/relationships/[relationshipId]/page.tsx", "utf8")
    const workspace = readFileSync("app/[workspaceSlug]/relationships/[relationshipId]/RelationshipDealWorkspace.tsx", "utf8")
    const gantt = readFileSync("app/[workspaceSlug]/relationships/[relationshipId]/RelationshipGantt.tsx", "utf8")
    const workflow = readFileSync("lib/relationship-workflow.ts", "utf8")

    assert.match(detail, /<RelationshipDealWorkspace/)
    assert.doesNotMatch(detail, /key=\{relationship\.updated_at\}/)
    assert.doesNotMatch(detail, /<details/)
    assert.doesNotMatch(detail, /Commercial details and delivery team/)
    for (const label of [
        "Planned project timeline",
        "Project timeline",
        "Services",
        "Description",
        "Review Relationship Information",
        "Review Onboarding",
        "Pricing",
        "Invoice Client",
        "Invoice sent",
        "Open invoice",
        "Recurring retainer",
        "Send retainer checkout",
    ]) assert.match(workspace, new RegExp(label))
    assert.match(workspace, /<BuilderPreview/)
    assert.doesNotMatch(workspace, /service_assignee_/)
    assert.match(gantt, /onInvoiceRequest\(\)/)
    assert.match(readFileSync("app/[workspaceSlug]/relationships/actions.ts", "utf8"), /existing\?\.assignee_user_id \?\? service\?\.defaultAssigneeId/)
    assert.match(workflow, /source_kind: "stripe_invoice"/)
    assert.match(workflow, /from\("asset_relationships"\)\.upsert/)
    assert.ok(workflow.indexOf("moveRelationshipToStage") < workflow.lastIndexOf("const assetId = await ensureRelationshipInvoiceAsset"))
})

test("sent-unpaid invoices can be voided and reopened without mutating their frozen snapshot", () => {
    const actions = readFileSync("app/[workspaceSlug]/relationships/actions.ts", "utf8")
    const detail = readFileSync("app/[workspaceSlug]/relationships/[relationshipId]/page.tsx", "utf8")
    const stripe = readFileSync("lib/stripe/api.ts", "utf8")
    assert.match(actions, /voidAndReopenRelationshipInvoice/)
    assert.match(actions, /voidStripeInvoice/)
    assert.match(actions, /rpc\("reopen_voided_client_sale"/)
    assert.match(actions, /\["invoice_sent", "payment_failed"\]/)
    assert.match(actions, /alreadyVoided/)
    assert.match(detail, /"invoice_inactive"/)
    assert.match(detail, /VoidInvoiceButton/)
    assert.match(stripe, /\/void`/)
})

test("recurring retainers create personalised Checkout and keep renewals out of onboarding", () => {
    const workflow = readFileSync("lib/relationship-workflow.ts", "utf8")
    const stripe = readFileSync("lib/stripe/api.ts", "utf8")
    const automation = readFileSync("lib/client-sales/automation.ts", "utf8")
    const webhook = readFileSync("app/api/stripe/webhook/route.ts", "utf8")
    const services = readFileSync("components/settings/ServiceCatalogue.tsx", "utf8")
    const migration = readFileSync("supabase/migrations/20260814090000_recurring_retainer_checkout.sql", "utf8")

    assert.match(stripe, /mode: "subscription"/)
    assert.match(stripe, /client_reference_id: saleId/)
    assert.match(stripe, /subscription_data\[metadata\]\[client_sale_id\]/)
    assert.match(stripe, /product_data\]\[name/)
    assert.match(stripe, /product_data\]\[description/)
    assert.match(stripe, /product_data\]\[images\]\[0/)
    assert.match(workflow, /sendRecurringCheckoutRequest/)
    assert.ok(workflow.indexOf("stripe_checkout_session_id: checkout.checkoutSessionId") < workflow.indexOf("await sendRecurringCheckoutRequest"))
    const paidHandler = automation.slice(automation.indexOf("export async function handlePaidStripeInvoice"))
    assert.match(paidHandler, /const isLaterRenewal/)
    assert.ok(paidHandler.indexOf("if (isLaterRenewal)") < paidHandler.indexOf("ensurePaidOnboardingSession(sale)"))
    assert.match(paidHandler, /stripe\.subscription\.renewal_paid/)
    assert.match(webhook, /checkout\.session\.completed/)
    assert.match(webhook, /customer\.subscription\./)
    assert.match(webhook, /stripe\.subscription\.renewal_failed/)
    assert.match(services, /service-thumbnails\/upload/)
    assert.match(services, /Checkout name/)
    assert.match(services, /Checkout description/)
    assert.match(migration, /billing_model in \('one_off', 'recurring'\)/)
    assert.match(migration, /reopen_expired_recurring_checkout/)
})

test("relationship and onboarding labels resolve versioned service revisions", () => {
    for (const file of [
        "app/[workspaceSlug]/relationships/page.tsx",
        "app/[workspaceSlug]/onboarding/page.tsx",
        "app/[workspaceSlug]/onboarding/[relationshipId]/page.tsx",
    ]) {
        const source = readFileSync(file, "utf8")
        assert.match(source, /relationshipServiceDisplayName/)
        assert.match(source, /service_revision_id/)
        assert.doesNotMatch(source, /SERVICES\[/)
    }
})

test("fulfilment and ClickUp service tasks resolve the selected immutable revision", () => {
    for (const file of [
        "lib/relationship-workflow.ts",
        "lib/client-messages/clickup-channel-setup.ts",
    ]) {
        const source = readFileSync(file, "utf8")
        assert.match(source, /service_revision_id/)
        assert.match(source, /loadOnboardingServiceRevisionDisplays/)
        assert.match(source, /relationshipFulfilmentServiceDefinition/)
    }
})
