import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import type { OnboardingServiceDefinition } from "../lib/onboarding/configuration-types.ts"
import { SERVICES } from "../lib/onboarding/services.ts"
import { normalizeServiceDefinition } from "../lib/onboarding/configuration-validation.ts"
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
        serviceType: "retainer",
        recurringName: "Current recurring service",
        recurringDescription: "Current recurring description",
        defaultBillingInterval: "month",
        defaultBillingIntervalCount: 1,
        state: "active",
        version: 3,
        isTest: true,
        defaultUpfrontPriceCents: 125_00,
        defaultRecurringPriceCents: 25_00,
        currency: "USD",
        defaultAssigneeId: null,
        displayPriority: 20,
        modules: [],
        archiveBlockers: [],
        lastEditedAt: null,
        ...overrides,
    }
}

test("service definitions default to one-time and require complete retainer defaults", () => {
    const oneTime = normalizeServiceDefinition({
        name: "Brand strategy",
        description: "Positioning and direction",
        serviceType: "one_time",
        defaultUpfrontPriceCents: 250_00,
        defaultRecurringPriceCents: 99_00,
        currency: "EUR",
    })
    assert.equal(oneTime.ok, true)
    if (oneTime.ok) {
        assert.equal(oneTime.definition.serviceType, "one_time")
        assert.equal(oneTime.definition.defaultRecurringPriceCents, 0)
    }

    const incompleteRetainer = normalizeServiceDefinition({
        name: "SEO setup",
        serviceType: "retainer",
        recurringName: "",
        defaultUpfrontPriceCents: 150_00,
        defaultRecurringPriceCents: 75_00,
        currency: "EUR",
    })
    assert.deepEqual(incompleteRetainer, { ok: false, error: "Give the recurring service a name before saving." })

    const retainer = normalizeServiceDefinition({
        name: "SEO setup",
        description: "Initial setup",
        serviceType: "retainer",
        recurringName: "SEO maintenance",
        recurringDescription: "Ongoing optimisation",
        defaultUpfrontPriceCents: 150_00,
        defaultRecurringPriceCents: 75_00,
        defaultBillingInterval: "month",
        defaultBillingIntervalCount: 3,
        currency: "EUR",
    })
    assert.equal(retainer.ok, true)
    if (retainer.ok) {
        assert.equal(retainer.definition.recurringName, "SEO maintenance")
        assert.equal(retainer.definition.defaultBillingIntervalCount, 3)
    }
})

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
        serviceType: "retainer",
        recurringName: "Original recurring name",
        recurringDescription: "Original recurring description",
        defaultBillingInterval: "month",
        defaultBillingIntervalCount: 1,
        checkoutDisplayName: "Original purchased name",
        checkoutDescription: "Original revision",
        thumbnailPath: null,
        defaultUpfrontPriceCents: 90_00,
        defaultRecurringPriceCents: 10_00,
        currency: "EUR",
        isTest: false,
    }
    const selected = [{
        service_key: retired.code,
        service_id: retired.id,
        service_revision_id: frozenRevision.id,
        upfront_price_cents: 85_00,
        recurring_price_cents: 15_00,
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
    assert.equal(retained?.selected?.upfront_price_cents, 85_00)
    assert.equal(retained?.selected?.recurring_price_cents, 15_00)
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

test("deal catalogue advances selected Active services to their current revision", () => {
    const active = service()
    const oldRevision: OnboardingServiceRevisionDisplay = {
        id: "88888888-8888-4888-8888-888888888888",
        serviceId: active.id,
        revisionNumber: 2,
        name: "Old service name",
        description: "Old description",
        serviceType: "one_time",
        recurringName: "",
        recurringDescription: "",
        defaultBillingInterval: "month",
        defaultBillingIntervalCount: 1,
        checkoutDisplayName: "Old service name",
        checkoutDescription: "Old description",
        thumbnailPath: null,
        defaultUpfrontPriceCents: 100_00,
        defaultRecurringPriceCents: 0,
        currency: "EUR",
        isTest: false,
    }
    const options = buildRelationshipDealServiceOptions({
        schemaReady: true,
        services: [active],
        selected: [{
            service_key: active.code,
            service_id: active.id,
            service_revision_id: oldRevision.id,
            upfront_price_cents: 110_00,
            recurring_price_cents: 20_00,
            currency: "EUR",
            assignee_user_id: null,
        }],
        revisions: new Map([[oldRevision.id, oldRevision]]),
    })
    assert.equal(options[0]?.revisionId, active.revisionId)
    assert.equal(options[0]?.name, active.name)
    assert.equal(options[0]?.selected?.upfront_price_cents, 110_00)
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
        serviceType: "one_time",
        recurringName: "",
        recurringDescription: "",
        defaultBillingInterval: "month",
        defaultBillingIntervalCount: 1,
        checkoutDisplayName: "Frozen service name",
        checkoutDescription: "",
        thumbnailPath: null,
        defaultUpfrontPriceCents: 0,
        defaultRecurringPriceCents: 0,
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

test("commercial save persists exact identities and dual negotiated prices", () => {
    const actions = readFileSync("app/[workspaceSlug]/relationships/actions.ts", "utf8")
    const detail = readFileSync("app/[workspaceSlug]/relationships/[relationshipId]/page.tsx", "utf8")
    assert.match(actions, /service_id: serviceId, service_revision_id: serviceRevisionId/)
    assert.match(actions, /service_currency_/)
    assert.match(actions, /upfront_price_cents/)
    assert.match(actions, /recurring_price_cents/)
    assert.match(actions, /This sale is already frozen/)
    assert.match(actions, /catalogue\.state !== "active"/)
    assert.match(actions, /rpc\("save_relationship_dual_pricing_configuration"/)
    assert.match(detail, /loadPublishedOnboardingConfiguration/)
    assert.match(detail, /buildRelationshipDealServiceOptions/)
    assert.doesNotMatch(detail, /Object\.entries\(SERVICES\)/)
})

test("relationship selling uses the visible details workspace and three-stage review", () => {
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
        "Sell client",
        "Primary messaging",
        "Outbound delivery",
        "Confirmation sent via",
        "Upfront fees",
        "Recurring total",
        "Due at Checkout",
    ]) assert.match(workspace, new RegExp(label))
    assert.match(workspace, /Send \$\{primaryMessagingProvider/)
    assert.match(workspace, /<BuilderPreview/)
    assert.match(workspace, /modules=\{assignedModules\}/)
    assert.match(workspace, /payment=\{payment\}/)
    assert.match(workspace, /Preview onboarding/)
    assert.match(workspace, /Published configuration is already in canonical composition order/)
    assert.doesNotMatch(workspace, /setPreviewModule/)
    assert.match(detail, /loadWorkspaceClientBrandAssets/)
    assert.match(detail, /logoSrc=\{agencyLogoSrc\}/)
    assert.doesNotMatch(workspace, /service_assignee_/)
    assert.match(gantt, /onInvoiceRequest\(\)/)
    assert.match(gantt, /currentWork\.action === "sell_client" \? "Sell client"/)
    assert.match(readFileSync("app/[workspaceSlug]/relationships/actions.ts", "utf8"), /existing\?\.assignee_user_id \?\? service\?\.defaultAssigneeId/)
    assert.doesNotMatch(workflow, /createAndSendStripeInvoice|sendRecurringCheckoutRequest/)
    assert.match(workflow, /kind: "checkout" as const/)
})

test("legacy invoice replacement paths are retired", () => {
    const actions = readFileSync("app/[workspaceSlug]/relationships/actions.ts", "utf8")
    const detail = readFileSync("app/[workspaceSlug]/relationships/[relationshipId]/page.tsx", "utf8")
    const stripe = readFileSync("lib/stripe/api.ts", "utf8")
    assert.doesNotMatch(actions, /voidAndReopenRelationshipInvoice|voidStripeInvoice|reopen_voided_client_sale/)
    assert.doesNotMatch(detail, /VoidInvoiceButton|Sent invoice is frozen|Finish preparing replacement/)
    assert.doesNotMatch(stripe, /createAndSendStripeInvoice|voidStripeInvoice/)
})

test("mixed Checkout combines upfront fees with recurring service charges", () => {
    const stripe = readFileSync("lib/stripe/api.ts", "utf8")
    const checkout = readFileSync("lib/client-sales/onboarding-checkout.ts", "utf8")
    const webhook = readFileSync("app/api/stripe/webhook/route.ts", "utf8")
    const services = readFileSync("components/settings/ServiceCatalogue.tsx", "utf8")
    const serviceValidation = readFileSync("lib/onboarding/configuration-validation.ts", "utf8")
    const migration = readFileSync("supabase/migrations/20260814170000_dual_component_checkout_reset.sql", "utf8")

    assert.match(stripe, /mode: recurring \? "subscription" : "payment"/)
    assert.match(stripe, /client_reference_id: saleId/)
    assert.match(stripe, /subscription_data\[metadata\]\[client_sale_id\]/)
    assert.match(stripe, /product_data\]\[name/)
    assert.match(stripe, /product_data\]\[description/)
    assert.match(stripe, /product_data\]\[images\]\[0/)
    assert.match(stripe, /billingComponent === "recurring"/)
    assert.match(stripe, /billing_component/)
    assert.doesNotMatch(stripe, /componentLabel|— \$\{componentLabel\}/)
    assert.match(checkout, /upfront_amount_cents/)
    assert.match(checkout, /recurring_amount_cents/)
    assert.match(checkout, /createStripeMixedCheckout/)
    assert.match(webhook, /checkout\.session\.completed/)
    assert.match(webhook, /customer\.subscription\./)
    assert.match(webhook, /stripe\.subscription\.renewal_failed/)
    assert.match(webhook, /stripe\.retired_sale_event_ignored/)
    assert.match(services, /service-thumbnails\/upload/)
    assert.match(services, /createPortal/)
    assert.match(services, /window\.parent\.document\.body/)
    assert.match(services, /One-time/)
    assert.match(services, /Retainer/)
    assert.match(services, /Upfront name/)
    assert.match(services, /Recurring name/)
    assert.match(services, /defaultBillingInterval/)
    assert.doesNotMatch(services, /Checkout name|Checkout description/)
    assert.match(serviceValidation, /serviceType === "retainer"/)
    assert.match(serviceValidation, /Give the recurring service a name/)
    assert.match(checkout, /name: upfrontName/)
    assert.match(checkout, /name: recurringName/)
    assert.match(checkout, /definition\.recurringDescription/)
    assert.match(migration, /default_upfront_price_cents/)
    assert.match(migration, /default_recurring_price_cents/)
    assert.doesNotMatch(migration, /update public\.onboarding_service_revisions\s+set default_upfront_price_cents/)
    assert.match(readFileSync("lib/onboarding/configuration.ts", "utf8"), /integer\(revision\.default_price_cents\)/)
    assert.match(migration, /retired_billing_model/)
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
