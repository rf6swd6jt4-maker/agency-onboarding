import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import test from "node:test"
import { getCompletedStepCount, getProgressPercentage } from "../lib/onboarding/progress.ts"
import {
    createTestFormResponse,
    getFileAcceptValue,
    getOnboardingForm,
    ONBOARDING_FORMS,
} from "../lib/onboarding/forms.ts"
import { maskToken } from "../lib/security/tokens.ts"
import {
    displayMessageAddress,
    formatClientInboundMessage,
    getEquivalentMessageAddresses,
    isUsablePhoneNumber,
    normalizeMessageAddress,
    resolvePrimaryMessagingProvider,
    toMetaWhatsAppRecipient,
} from "../lib/client-messages/addresses.ts"
import { shouldIgnoreClickUpMessage } from "../lib/client-messages/clickup-message-filters.ts"
import { parseClickUpWorkspaceId } from "../lib/client-messages/clickup-workspace.ts"
import { formatMetaWhatsAppApiError } from "../lib/client-messages/meta-whatsapp-errors.ts"
import { isConsentConfirmationText } from "../lib/client-sales/consent.ts"
import { SERVICES, getModuleKeysForServices } from "../lib/onboarding/services.ts"
import { verifyStripeWebhookSignature } from "../lib/stripe/signature.ts"
import { getStripeCustomerPhone } from "../lib/stripe/format.ts"
import { isOnboardingStuck } from "../lib/onboarding/stuck.ts"
import {
    getProjectTimeframeDays,
    getProjectDeadlineTimestamp,
    splitProjectTimeframeDays,
} from "../lib/onboarding/project-timeframe.ts"
import {
    classifyUploadAsset,
    onboardingSnapshotStepNativeKey,
    onboardingSnapshotSubmissionNativeKey,
    onboardingSnapshotUploadNativeKey,
    onboardingStepNativeKey,
    onboardingSubmissionNativeKey,
    onboardingUploadNativeKey,
} from "../lib/onboarding/canonical-keys.ts"
import { resolveOrderedModuleSources } from "../lib/onboarding/session-composition-order.ts"

test("counts unique completed onboarding steps", () => {
    const steps = [{ key: "welcome" }, { key: "business-info" }]

    assert.equal(
        getCompletedStepCount(steps, [
            "welcome",
            "welcome",
            "unknown-step",
        ]),
        1
    )
})

test("calculates rounded progress percentage", () => {
    const steps = [
        { key: "welcome" },
        { key: "business-info" },
        { key: "competitors" },
    ]

    assert.equal(getProgressPercentage(steps, ["welcome"]), 33)
})

test("empty step lists are treated as complete", () => {
    assert.equal(getProgressPercentage([], []), 100)
})

test("creates type-aware answers for test onboarding forms", () => {
    const existingUpload = {
        name: "example.pdf",
        path: "workspace/onboarding/example.pdf",
        size: 128,
        type: "application/pdf",
        kind: "document" as const,
        provider: "r2" as const,
    }
    const response = createTestFormResponse({
        key: "custom-step",
        title: "Custom step",
        intro: "",
        fields: [
            { name: "website", label: "Website", type: "url", required: true },
            { name: "email", label: "Email", type: "email", required: true },
            { name: "phone", label: "Phone", type: "tel", required: true },
            { name: "summary", label: "Summary", type: "text", required: true },
            { name: "details", label: "Details", type: "textarea", required: true },
            { name: "proof", label: "Proof", type: "file" },
        ],
    }, { proof: [existingUpload] })

    assert.equal(response.website, "https://example.com")
    assert.match(String(response.email), /^[^\s@]+@[^\s@]+\.[^\s@]+$/u)
    assert.match(String(response.phone), /^\+353/u)
    assert.equal(response.summary, "Example business information")
    assert.match(String(response.details), /example information/u)
    assert.deepEqual(response.proof, [existingUpload])
})

test("maps fulfilment services to required onboarding modules", () => {
    assert.deepEqual(
        getModuleKeysForServices([
            "seo",
            "google-ads",
            "landing-page-creation",
        ]),
        ["general-info", "google-search-ads", "website-lp"]
    )
})

test("builds stable canonical onboarding native keys", () => {
    assert.equal(onboardingStepNativeKey("session-1", "business-info"), "session-1:business-info")
    assert.equal(onboardingSubmissionNativeKey("session-1", "business-info"), "session-1:business-info:submission")
    assert.equal(onboardingUploadNativeKey("session-1", "logo", "workspace/path/logo.png"), "session-1:logo:upload:workspace/path/logo.png")
})

test("builds stable snapshot onboarding native keys without colliding with legacy keys", () => {
    assert.equal(onboardingSnapshotStepNativeKey("session-1", "step-1"), "session-1:step:step-1")
    assert.equal(onboardingSnapshotSubmissionNativeKey("session-1", "step-1"), "session-1:step:step-1:submission")
    assert.equal(onboardingSnapshotUploadNativeKey("session-1", "step-1", "workspace/path/logo.png"), "session-1:step:step-1:upload:workspace/path/logo.png")
})

test("uses the global Builder order while resolving service priority and deduplicating modules", () => {
    const modules = [
        { id: "high-only", revisionId: "high-r1", status: "published" },
        { id: "mandatory", revisionId: "mandatory-r1", status: "published" },
        { id: "shared", revisionId: "shared-r1", status: "published" },
        { id: "low-only", revisionId: "low-r1", status: "published" },
        { id: "draft", revisionId: "draft-r1", status: "draft" },
    ]
    const sources = resolveOrderedModuleSources({
        modules,
        mandatoryModuleIds: ["mandatory", "shared"],
        services: [
            {
                revisionId: "low-service-r1",
                code: "low",
                state: "active",
                displayPriority: 10,
                modules: [
                    { moduleId: "low-only", sortOrder: 0 },
                    { moduleId: "shared", sortOrder: 10 },
                ],
            },
            {
                revisionId: "high-service-r1",
                code: "high",
                state: "active",
                displayPriority: 100,
                modules: [
                    { moduleId: "shared", sortOrder: 0 },
                    { moduleId: "high-only", sortOrder: 10 },
                    { moduleId: "draft", sortOrder: 20 },
                ],
            },
        ],
    })

    assert.deepEqual(sources, [
        { moduleId: "high-only", sourceKind: "service", sourceServiceRevisionId: "high-service-r1" },
        { moduleId: "mandatory", sourceKind: "mandatory", sourceServiceRevisionId: null },
        { moduleId: "shared", sourceKind: "mandatory", sourceServiceRevisionId: null },
        { moduleId: "low-only", sourceKind: "service", sourceServiceRevisionId: "low-service-r1" },
    ])
})

test("classifies onboarding uploads as canonical asset kinds", () => {
    assert.equal(classifyUploadAsset({ name: "logo.png", type: "image/png" }), "media")
    assert.equal(classifyUploadAsset({ name: "brief.pdf", type: "application/pdf" }), "document")
    assert.equal(classifyUploadAsset({ name: "notes.txt", type: "text/plain" }), "file")
})

test("defines SEO SOP subtasks in ClickUp execution order", () => {
    assert.deepEqual(
        SERVICES.seo.sopSteps.map((step) => step.key),
        [
            "confirm-access-and-pre-sale-groundwork",
            "run-benchmark-heatmap",
            "easy-win-audit",
            "pick-main-keyword-and-competitive-analysis",
            "optimize-gbp-categories-and-profile",
            "optimize-gbp-services-and-descriptions",
            "optimize-gbp-bookings-and-faq",
            "on-page-seo-basic",
            "citations-basic",
            "on-page-seo-advanced-content-and-structure",
            "citations-advanced",
            "weekly-maintenance-and-client-habits",
            "report-fake-black-hat-competitor-listing",
        ]
    )

    assert.match(SERVICES.seo.sopSteps[0].description ?? "", /Stage: Setup/u)
    assert.match(
        SERVICES.seo.sopSteps[9].description ?? "",
        /Stage: Advanced - skip on first run/u
    )
})

test("service SOP step keys are unique within each service", () => {
    for (const service of Object.values(SERVICES)) {
        const keys = service.sopSteps.map((step) => step.key)
        assert.deepEqual(
            keys,
            [...new Set(keys)],
            `${service.key} has duplicate SOP step keys`
        )
    }
})

test("converts project timeframe units for fulfilment deadlines", () => {
    assert.equal(getProjectTimeframeDays(30, "days"), 30)
    assert.equal(getProjectTimeframeDays(2, "weeks"), 14)
    assert.equal(getProjectTimeframeDays(1, "months"), 30)
    assert.equal(getProjectTimeframeDays(0, "days"), null)
    assert.deepEqual(splitProjectTimeframeDays(14), {
        amount: 2,
        unit: "weeks",
    })

    assert.equal(
        getProjectDeadlineTimestamp({
            days: 14,
            from: new Date("2026-06-15T00:00:00.000Z"),
        }),
        new Date("2026-06-29T00:00:00.000Z").getTime()
    )
})

test("marks incomplete inactive onboarding as stuck", () => {
    assert.equal(
        isOnboardingStuck({
            percentage: 75,
            createdAt: "2026-06-01T00:00:00.000Z",
            lastActivityAt: "2026-06-10T00:00:00.000Z",
            now: new Date("2026-06-15T00:00:00.000Z"),
            stuckAfterDays: 3,
        }),
        true
    )

    assert.equal(
        isOnboardingStuck({
            percentage: 100,
            createdAt: "2026-06-01T00:00:00.000Z",
            lastActivityAt: "2026-06-10T00:00:00.000Z",
            now: new Date("2026-06-15T00:00:00.000Z"),
            stuckAfterDays: 3,
        }),
        false
    )
})

test("masks session tokens while preserving enough characters for debugging", () => {
    assert.equal(
        maskToken("1234567890abcdef1234567890abcdef"),
        "123456...abcdef"
    )
})

test("defines every expected client onboarding form", () => {
    assert.deepEqual(Object.keys(ONBOARDING_FORMS).sort(), [
        "accreditations",
        "before-after-images",
        "branding",
        "business-info",
        "competitors",
        "cta-information",
        "history",
        "logo",
        "process",
        "team-pictures",
        "usps",
        "video-assets",
        "web-access",
    ])
})

test("looks up configured form definitions", () => {
    assert.equal(getOnboardingForm("business-info")?.title, "Business information")
    assert.equal(getOnboardingForm("missing-form"), null)
})

test("maps upload accept helpers for browser file inputs", () => {
    assert.equal(getFileAcceptValue("image"), "image/*")
    assert.equal(getFileAcceptValue("video"), "video/*")
    assert.match(getFileAcceptValue("document") ?? "", /\.pdf/u)
    assert.match(getFileAcceptValue("document") ?? "", /\.docx/u)
})

test("normalizes WhatsApp bridge addresses", () => {
    assert.equal(
        normalizeMessageAddress("+1 (555) 123-4567"),
        "whatsapp:+15551234567"
    )
    assert.equal(
        normalizeMessageAddress("whatsapp:+1 (555) 123-4567"),
        "whatsapp:+15551234567"
    )
    assert.equal(
        normalizeMessageAddress("whatsapp:15551234567"),
        "whatsapp:+15551234567"
    )
    assert.equal(
        normalizeMessageAddress("214 973 2742"),
        "whatsapp:+12149732742"
    )
    assert.equal(
        normalizeMessageAddress("+2149732742"),
        "whatsapp:+12149732742"
    )
    assert.equal(
        normalizeMessageAddress("+353 089 983 1234"),
        "whatsapp:+353899831234"
    )
    assert.equal(
        normalizeMessageAddress("089 983 1234"),
        "whatsapp:+10899831234"
    )
    assert.equal(
        normalizeMessageAddress("00353 089 983 1234"),
        "whatsapp:+353899831234"
    )
    assert.equal(
        normalizeMessageAddress("+353-089-983-1234 x99"),
        "whatsapp:+353899831234"
    )
    assert.equal(
        normalizeMessageAddress("whatsapp:+44 (0) 7700 900123"),
        "whatsapp:+447700900123"
    )
})

test("selects whichever client messaging number is actually available", () => {
    assert.equal(isUsablePhoneNumber("+353 89 983 1234"), true)
    assert.equal(isUsablePhoneNumber(""), false)
    assert.equal(resolvePrimaryMessagingProvider({
        requestedProvider: "meta_whatsapp",
        smsPhone: "+353 89 983 1234",
        whatsappPhone: "",
    }), "twilio_sms")
    assert.equal(resolvePrimaryMessagingProvider({
        requestedProvider: "twilio_sms",
        smsPhone: "",
        whatsappPhone: "+353 89 983 1234",
    }), "meta_whatsapp")
    assert.equal(resolvePrimaryMessagingProvider({
        requestedProvider: "meta_whatsapp",
        smsPhone: "+353 89 983 1234",
        whatsappPhone: "+353 89 983 5678",
    }), "meta_whatsapp")
})

test("matches legacy Irish WhatsApp number variants", () => {
    assert.deepEqual(
        getEquivalentMessageAddresses("whatsapp:+353899831234"),
        ["whatsapp:+353899831234", "whatsapp:+3530899831234"]
    )
    assert.deepEqual(
        getEquivalentMessageAddresses("whatsapp:+3530899831234"),
        ["whatsapp:+353899831234", "whatsapp:+3530899831234"]
    )
})

test("matches legacy US WhatsApp numbers missing the country code", () => {
    assert.deepEqual(
        getEquivalentMessageAddresses("whatsapp:+12149732742"),
        ["whatsapp:+12149732742", "whatsapp:+2149732742"]
    )
})

test("converts normalized bridge addresses for Meta WhatsApp sends", () => {
    assert.equal(toMetaWhatsAppRecipient("+1 (555) 123-4567"), "15551234567")
    assert.equal(
        toMetaWhatsAppRecipient("whatsapp:+15551234567"),
        "15551234567"
    )
    assert.equal(toMetaWhatsAppRecipient("+2149732742"), "12149732742")
})

test("shows phone numbers without the bridge channel prefix", () => {
    assert.equal(
        displayMessageAddress("whatsapp:+15551234567"),
        "+15551234567"
    )
})

test("formats the first client message in a run with a client name", () => {
    assert.equal(
        formatClientInboundMessage({
            clientName: "Rick",
            body: "Hello",
        }),
        "**Rick**\nHello"
    )
    assert.equal(
        formatClientInboundMessage({
            clientName: "Rick",
            body: "Another thing",
            showClientName: false,
        }),
        "Another thing"
    )
})

test("ignores ClickUp messages that were posted by the bridge", () => {
    assert.equal(
        shouldIgnoreClickUpMessage({
            body: "**Rick**\nHello",
            authorId: null,
            authorName: null,
        }),
        true
    )
    assert.equal(
        shouldIgnoreClickUpMessage({
            body: "Hello from the team",
            authorId: null,
            authorName: "Sarah",
        }),
        false
    )
    assert.equal(
        shouldIgnoreClickUpMessage({
            body: "Video: [open video](https://betelgeze.com/api/client-messages/media/client/video.mp4)",
            authorId: null,
            authorName: "Sarah",
        }),
        true
    )
    assert.equal(
        shouldIgnoreClickUpMessage({
            body: "![Image](https://betelgeze.com/api/client-messages/media/client/image.jpg)\n[Open image](https://betelgeze.com/api/client-messages/media/client/image.jpg)",
            authorId: null,
            authorName: "Sarah",
        }),
        true
    )
    assert.equal(
        shouldIgnoreClickUpMessage({
            body: "Could you send a video of the finished room?",
            authorId: null,
            authorName: "Sarah",
        }),
        false
    )
})

test("extracts numeric ClickUp workspace IDs from plain IDs or URLs", () => {
    assert.equal(parseClickUpWorkspaceId("9012345678"), "9012345678")
    assert.equal(
        parseClickUpWorkspaceId("https://app.clickup.com/9012345678/v/c/abc"),
        "9012345678"
    )
})

test("explains Meta WhatsApp token authentication failures", () => {
    const message = formatMetaWhatsAppApiError({
        action: "Meta WhatsApp message",
        status: 401,
        responseBody: JSON.stringify({
            error: {
                message: "Authentication Error",
                code: 190,
                type: "OAuthException",
            },
        }),
    })

    assert.match(message, /Meta code 190/u)
    assert.match(message, /META_WHATSAPP_ACCESS_TOKEN/u)
})

test("detects WhatsApp consent confirmation replies", () => {
    assert.equal(isConsentConfirmationText("CONFIRM"), true)
    assert.equal(isConsentConfirmationText(" confirm "), true)
    assert.equal(isConsentConfirmationText("yes"), false)
})

test("verifies Stripe webhook signatures", () => {
    const payload = JSON.stringify({ id: "evt_test", type: "invoice.paid" })
    const secret = "whsec_test"
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = createHmac("sha256", secret)
        .update(`${timestamp}.${payload}`)
        .digest("hex")

    assert.equal(
        verifyStripeWebhookSignature({
            payload,
            secret,
            signatureHeader: `t=${timestamp},v1=${signature}`,
        }),
        true
    )
    assert.equal(
        verifyStripeWebhookSignature({
            payload,
            secret,
            signatureHeader: `t=${timestamp},v1=bad`,
        }),
        false
    )
})

test("formats WhatsApp bridge numbers for Stripe customers", () => {
    assert.equal(
        getStripeCustomerPhone("whatsapp:+12149732742"),
        "+12149732742"
    )
    assert.equal(getStripeCustomerPhone("+12149732742"), "+12149732742")
})
