import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { sanitizeOnboardingOutboxError } from "../lib/onboarding/outbox-safety.ts"
import {
    getFileAcceptValue,
    MAX_ONBOARDING_UPLOAD_SIZE,
    validateOnboardingUploadFile,
} from "../lib/onboarding/forms.ts"

const canonical = readFileSync("lib/onboarding/canonical.ts", "utf8")
const saleAutomation = readFileSync("lib/client-sales/automation.ts", "utf8")
const relationshipWorkflow = readFileSync("lib/relationship-workflow.ts", "utf8")
const relationshipActions = readFileSync("app/[workspaceSlug]/relationships/actions.ts", "utf8")
const archiveRelationshipForm = readFileSync("app/[workspaceSlug]/relationships/[relationshipId]/ArchiveRelationshipForm.tsx", "utf8")
const stripeWebhook = readFileSync("app/api/stripe/webhook/route.ts", "utf8")
const publicPage = readFileSync("app/onboarding/session/[token]/page.tsx", "utf8")
const previewPage = readFileSync("app/onboarding/preview/[token]/page.tsx", "utf8")
const builderPreview = readFileSync("components/onboarding-builder/BuilderPreview.tsx", "utf8")
const onboardingLayout = readFileSync("components/onboarding/OnboardingLayout.tsx", "utf8")
const onboardingBlocks = readFileSync("components/onboarding/OnboardingBlocks.tsx", "utf8")
const stripePaymentButton = readFileSync("components/onboarding/StripePaymentButtonLabel.tsx", "utf8")
const staffPage = readFileSync("app/[workspaceSlug]/onboarding/[relationshipId]/page.tsx", "utf8")
const tokenActions = readFileSync("app/[workspaceSlug]/onboarding/[relationshipId]/actions.ts", "utf8")
const outboxWorker = readFileSync("lib/onboarding/outbox.ts", "utf8")
const outboxRoute = readFileSync("app/api/cron/onboarding-outbox/route.ts", "utf8")
const onboardingCheckout = readFileSync("lib/client-sales/onboarding-checkout.ts", "utf8")
const onboardingCheckoutRoute = readFileSync("app/api/onboarding/session/[token]/checkout/route.ts", "utf8")
const onboardingPaymentReturnRoute = readFileSync("app/api/onboarding/session/[token]/payment-return/route.ts", "utf8")
const onboardingBlockDefinition = readFileSync("lib/onboarding/block-definition.ts", "utf8")
const onboardingBlockValidation = readFileSync("lib/onboarding/block-validation.ts", "utf8")
const builderActions = readFileSync("app/[workspaceSlug]/onboarding-builder/actions.ts", "utf8")
const publicActions = readFileSync("app/onboarding/session/[token]/actions.ts", "utf8")
const onboardingForm = readFileSync("components/onboarding/OnboardingForm.tsx", "utf8")
const onboardingOperations = readFileSync("supabase/migrations/20260810101000_custom_onboarding_operations.sql", "utf8")
const builderInvoiceSessions = readFileSync("supabase/migrations/20260811113000_align_invoice_sessions_with_builder.sql", "utf8")
const relationshipArchive = readFileSync("supabase/migrations/20260811143000_archive_relationships.sql", "utf8")
const relationshipArchiveFix = readFileSync("supabase/migrations/20260811150000_fix_relationship_archive_activity.sql", "utf8")
const salePaymentGateMigration = readFileSync("supabase/migrations/20260814140000_sale_confirmation_payment_gate.sql", "utf8")
const testBlockSkipMigration = readFileSync("supabase/migrations/20260903110000_allow_test_onboarding_block_skips.sql", "utf8")
const environmentExample = readFileSync(".env.example", "utf8")
const readme = readFileSync("README.md", "utf8")
const runtimeMode = readFileSync("lib/onboarding/runtime-mode.ts", "utf8")
const proxy = readFileSync("proxy.ts", "utf8")

test("sale confirmation prepares the immutable session and payment reuses it before unlock", () => {
    assert.match(saleAutomation, /rpc\("prepare_confirmed_onboarding_session"/u)
    assert.match(saleAutomation, /sale\.onboarding_session_id/u)
    assert.match(saleAutomation, /relationship_onboarding_sessions/u)
    assert.match(saleAutomation, /p_idempotency_key:\s*`onboarding\.confirmed:\$\{sale\.id\}`/u)
    assert.match(saleAutomation, /handleCompletedStripeCheckout/u)
    assert.match(saleAutomation, /activateRelationshipOnboardingAfterPayment/u)
})

test("confirmed sales expose one fixed Payment step that creates hosted Stripe Checkout before onboarding unlocks", () => {
    assert.match(onboardingBlockDefinition, /ONBOARDING_PAYMENT_STEP_ID/u)
    assert.match(onboardingBlockDefinition, /ONBOARDING_PAYMENT_BUTTON_ID/u)
    assert.match(onboardingBlockValidation, /payment\.steps\.length !== 1/u)
    assert.match(onboardingBlockValidation, /Payment must retain its fixed Pay button/u)
    assert.match(publicPage, /onboardingPaymentPending\(paymentContext\)/u)
    assert.match(publicPage, /\/api\/onboarding\/session\/\$\{token\}\/checkout/u)
    assert.match(onboardingBlocks, /block\.id === ONBOARDING_PAYMENT_BUTTON_ID/u)
    assert.match(onboardingBlocks, /bg-\[#635bff\]/u)
    assert.match(stripePaymentButton, /Pay with Stripe/u)
    assert.match(stripePaymentButton, /stripe-wordmark-white\.jpg/u)
    assert.match(onboardingCheckout, /createStripeMixedCheckout/u)
    assert.match(onboardingCheckout, /billingComponent: "upfront"/u)
    assert.match(onboardingCheckout, /billingComponent: "recurring"/u)
    assert.match(onboardingCheckout, /successUrl: `\$\{input\.origin\}\/api\/onboarding\/session\/\$\{input\.token\}\/payment-return/u)
    assert.match(onboardingCheckout, /cancelUrl: `\$\{returnUrl\}\?payment=cancelled`/u)
    assert.match(onboardingCheckout, /customDomainVerified: context\.workspace\.custom_onboarding_domain_status === "verified"/u)
    assert.match(onboardingCheckoutRoute, /new URL\(result\.checkoutUrl!\)/u)
    assert.match(onboardingCheckoutRoute, /result\.paid \? new URL\(result\.returnUrl\)/u)
    assert.match(onboardingCheckoutRoute, /Response\.redirect\(destination, 303\)/u)
    assert.match(onboardingPaymentReturnRoute, /handleCompletedStripeCheckout/u)
    assert.match(onboardingPaymentReturnRoute, /onboardingPaymentReturnUrl\(context, token\)/u)
    assert.match(proxy, /platformSessionToken = path\.match\(\/\^\\\/onboarding\\\/session/u)
    assert.match(proxy, /withRedirect\(request, `\/\$\{platformSessionToken\[1\]\}`\)/u)
    assert.match(stripeWebhook, /checkout\.session\.completed/u)
    assert.match(stripeWebhook, /checkout\.session\.async_payment_succeeded/u)
    assert.match(stripeWebhook, /checkout\.session\.async_payment_failed/u)
    assert.match(stripeWebhook, /checkout\.session\.expired/u)
    assert.match(stripeWebhook, /stripe_checkout_url: null/u)
    assert.match(salePaymentGateMigration, /create or replace function public\.prepare_confirmed_onboarding_session/u)
    assert.match(salePaymentGateMigration, /current_user in \('service_role', 'postgres'\)/u)
    assert.match(salePaymentGateMigration, /Published onboarding configuration assignments are immutable/u)
    assert.match(salePaymentGateMigration, /set status = 'onboarding_payment_pending'/u)
    assert.match(salePaymentGateMigration, /set lifecycle_phase = 'sold'/u)
})

test("selling retries reuse the frozen sale and never duplicate an in-flight or sent WhatsApp confirmation", () => {
    assert.match(relationshipWorkflow, /"sold_confirmation_sending"/u)
    assert.match(relationshipWorkflow, /"sold_awaiting_whatsapp_confirm"/u)
    assert.match(relationshipWorkflow, /findResumableFrozenSale/u)
    assert.match(relationshipWorkflow, /status: "sale_confirmation_pending"/u)
    assert.match(relationshipActions, /"inProgress" in consent && consent\.inProgress/u)
    assert.match(saleAutomation, /CONSENT_TEMPLATE_TERMINAL_STATUSES/u)
    assert.match(saleAutomation, /sale\.consent_template_sent_at/u)
    assert.match(saleAutomation, /sale\.status === "paid"/u)
    assert.match(saleAutomation, /"onboarding_payment_pending",\s*"onboarding_link_sent"/u)
})

test("selling freezes versioned configuration before Checkout can be created", () => {
    assert.match(relationshipWorkflow, /preflightRelationshipSale/u)
    assert.match(relationshipWorkflow, /rpc\("freeze_client_sale_configuration"/u)
    assert.doesNotMatch(relationshipWorkflow, /createAndSendStripeInvoice|createStripeSubscriptionCheckout/u)
    assert.match(onboardingCheckout, /createStripeMixedCheckout/u)
    assert.match(relationshipActions, /This sale is already frozen\. Create a replacement sale before changing services or negotiated prices/u)
})

test("invoice snapshots and paid sessions use the published Builder module composition", () => {
    assert.match(builderInvoiceSessions, /create or replace function public\.freeze_client_sale_configuration/u)
    assert.match(builderInvoiceSessions, /definition->'sortOrder'/u)
    assert.match(builderInvoiceSessions, /definition->'serviceIds'/u)
    assert.match(builderInvoiceSessions, /definition->>'mandatory'/u)
    assert.match(builderInvoiceSessions, /'header', 'estimate', 'form', 'video', 'button', 'checklist'/u)
    assert.match(builderInvoiceSessions, /'composition_source', 'published_builder_modules'/u)
    assert.match(builderInvoiceSessions, /create or replace function public\.create_paid_onboarding_session/u)
    assert.match(builderInvoiceSessions, /item_kind = 'module'/u)
    assert.doesNotMatch(builderInvoiceSessions, /SALE_BOOKENDS_REQUIRED/u)
    assert.match(builderInvoiceSessions, /'source', 'published_builder_modules'/u)
    assert.match(canonical, /paidSessionHasPublicConsent/u)
    assert.match(canonical, /select\("consent_confirmed_at"\)/u)
    assert.match(canonical, /return await paidSessionHasPublicConsent\(session\) \? session : null/u)
})

test("invoice preflight requires a verified connection without requiring the optional help action", () => {
    const preflight = relationshipWorkflow.slice(
        relationshipWorkflow.indexOf("async function preflightRelationshipSale"),
        relationshipWorkflow.indexOf("export async function prepareRelationshipSale")
    )
    assert.match(preflight, /configuration\.help\.whatsappVerified/u)
    assert.doesNotMatch(preflight, /configuration\.help\.whatsappEnabled/u)
})

test("real manual onboarding is payment-gated while flagged test relationships remain supported", () => {
    assert.match(relationshipActions, /phase === "onboarding" && !isTest/u)
    assert.match(relationshipActions, /if \(!isTestRelationship\) redirect\([^\n]+payment-required/u)
})

test("public, draft-link, and embedded Builder previews use the shared session renderer", () => {
    assert.match(publicPage, /<OnboardingSessionRenderer/u)
    assert.match(previewPage, /<OnboardingSessionRenderer/u)
    assert.match(builderPreview, /<OnboardingSessionRenderer/u)
    assert.match(previewPage, /configuredStepToRenderStep/u)
    assert.match(builderPreview, /configuredStepToRenderStep/u)
    assert.match(builderPreview, /<OnboardingLayout/u)
    assert.match(builderPreview, /embedded/u)
    assert.match(onboardingLayout, /embedded\?: boolean/u)
    assert.match(previewPage, /href: index <= selectedIndex/u)
})

test("snapshot runtime addresses drafts, notices, staff answers, and client activity by stable IDs", () => {
    assert.match(canonical, /sessionModuleId:\s*step\.sessionModuleId/u)
    assert.match(canonical, /onboarding_step_drafts/u)
    assert.match(canonical, /onboarding_session_notices/u)
    assert.match(canonical, /actorKind:\s*"client"/u)
    assert.match(canonical, /const stepCompletionIdempotencyKey = `onboarding\.step\.completed:/u)
    assert.match(canonical, /p_idempotency_key:\s*stepCompletionIdempotencyKey/u)
    assert.match(staffPage, /fieldLabels:\s*Object\.fromEntries/u)
    assert.match(staffPage, /Client requested an edit/u)
})

test("migrated form responses remap legacy field names to stable snapshot field IDs", () => {
    const responseLoader = canonical.slice(
        canonical.indexOf("export async function getFormResponseAsset"),
        canonical.indexOf("async function findStepWorkItem")
    )
    assert.match(responseLoader, /relationship_onboarding_session_fields/u)
    assert.match(responseLoader, /legacy_field_name/u)
    assert.match(responseLoader, /remapped\[stableId\] = remapped\[legacyName\]/u)
    assert.match(responseLoader, /stableId in remapped/u)
})

test("manual and flagged-test session creation records sanitized composition before start", () => {
    const creator = canonical.slice(canonical.indexOf("export async function createRelationshipOnboardingSession"))
    const composedIndex = creator.indexOf('eventKey: "onboarding.session.composed"')
    const startedIndex = creator.indexOf('eventKey: "onboarding.session.started"')
    assert.ok(composedIndex >= 0 && composedIndex < startedIndex)
    assert.match(creator, /configuration_revision_id:\s*normalizedComposition\.configurationRevisionId/u)
    assert.match(creator, /composition_hash:\s*normalizedComposition\.compositionHash/u)
    assert.match(creator, /migration_fallback:\s*"legacy_hard_coded"/u)
})

test("token rotation and revocation preserve sessions while invalidating old links", () => {
    assert.match(tokenActions, /token_revoked_at:\s*new Date/u)
    assert.match(tokenActions, /session_token:\s*token, token_version:\s*tokenVersion, token_revoked_at:\s*null/u)
    assert.match(tokenActions, /getOnboardingUrl\(/u)
})

test("duplicate Stripe billing events remain resumable and idempotent", () => {
    assert.match(stripeWebhook, /duplicateEvent && !isResumableAutomationEvent/u)
    assert.match(stripeWebhook, /idempotencyKey:\s*`stripe\.subscription\.invoice_paid:/u)
})

test("paid Stripe events ignore invoices without Betelgeze ownership metadata", () => {
    assert.match(stripeWebhook, /if \(!saleId\)/u)
    assert.match(stripeWebhook, /eventKey: "stripe\.invoice\.paid_ignored"/u)
    assert.match(stripeWebhook, /return Response\.json\(\{ ok: true, ignored: true/u)
})

test("Stripe billing automation remains inside the verified workspace", () => {
    assert.match(stripeWebhook, /sale\.workspace_id !== connectedWorkspaceId/u)
    assert.match(stripeWebhook, /\.eq\("id", saleId\)\.eq\("workspace_id", workspaceId\)/u)
    assert.match(stripeWebhook, /handleCompletedStripeCheckout\(checkout, workspaceId\)/u)
    assert.doesNotMatch(stripeWebhook, /record_stripe_invoice_status_event/u)
})

test("stale consent claims reconcile safely without blind WhatsApp retries", () => {
    const consent = saleAutomation.slice(
        saleAutomation.indexOf("export async function sendSaleConsentTemplate"),
        saleAutomation.indexOf("export async function handleCompletedStripeCheckout")
    )
    assert.match(consent, /CONSENT_TEMPLATE_CLAIM_TIMEOUT_MS/u)
    assert.match(consent, /\.contains\("raw_payload", \{ client_sale_id: saleId \}\)/u)
    assert.match(consent, /previousMessage\?\.status === "sent"/u)
    assert.match(consent, /previousMessage\?\.status === "sending"/u)
    assert.match(consent, /\.eq\("status", sendingStatus\)[\s\S]{0,120}\.eq\("updated_at", sale\.updated_at\)/u)
    assert.match(consent, /create_consent_message_log[\s\S]+status: failedStatus/u)
    assert.match(consent, /consent_claimed_at: claimStartedAt/u)
    assert.match(consent, /verify_consent_claim/u)
})

test("runtime modes preserve Settings authoring while confirmed sales always use the frozen Builder session", () => {
    assert.match(runtimeMode, /if \(!normalized \|\| normalized === "versioned"\) return "versioned"/u)
    assert.match(runtimeMode, /normalized === "shadow" \|\| normalized === "legacy"/u)
    assert.match(runtimeMode, /ONBOARDING_RUNTIME_MODE must be versioned, shadow, or legacy/u)
    assert.match(runtimeMode, /displayPriority: identity === "legacy"[\s\S]{0,120}selectedServices\.length - index/u)
    assert.match(canonical, /compositionSource[\s\S]{0,120}\? compositionSource === "legacy"[\s\S]{0,120}: getOnboardingRuntimeMode\(\) !== "versioned"/u)
    assert.match(saleAutomation, /rpc\("prepare_confirmed_onboarding_session"/u)
    assert.doesNotMatch(saleAutomation, /createCompatibilityOnboardingSession/u)
})

test("durable onboarding outbox claims, crash-recovers, and finishes delivery and cleanup independently", () => {
    assert.match(outboxWorker, /claim_onboarding_delivery_outbox/u)
    assert.match(outboxWorker, /finish_onboarding_delivery_outbox/u)
    assert.match(outboxWorker, /claim_onboarding_storage_cleanup_outbox/u)
    assert.match(outboxWorker, /finish_onboarding_storage_cleanup_outbox/u)
    assert.match(outboxWorker, /contains\("raw_payload", \{ outbox_id: row\.id \}\)/u)
    assert.match(outboxWorker, /if \(sentMessage\.data\)/u)
    assert.match(outboxWorker, /deleteOnboardingUploads\(\[storagePath\]\)/u)
    assert.match(outboxWorker, /const storagePath = row\.storage_path\n/u)
    assert.doesNotMatch(outboxWorker, /const storagePath = row\.storage_path\.trim\(\)/u)
    assert.match(outboxWorker, /for \(const row of deliveryRows\)/u)
    assert.match(outboxWorker, /for \(const row of cleanupRows\)/u)
    assert.match(outboxWorker, /client_sale_id:\s*saleId/u)
    assert.match(outboxWorker, /client_id:\s*clientId/u)
})

test("client writes are limited to the first incomplete onboarding step", () => {
    assert.match(canonical, /const firstIncompleteIndex = resolved\.completableSteps\.findIndex/u)
    assert.match(canonical, /if \(stepIndex !== firstIncompleteIndex\) throw new Error\("Complete the earlier onboarding step first\."\)/u)
    assert.match(publicActions, /const firstIncompleteIndex = resolved\.completableSteps\.findIndex/u)
    assert.doesNotMatch(publicPage, /session\.is_test \|\| session\.status/u)
    const stepRpc = onboardingOperations.slice(
        onboardingOperations.indexOf("create or replace function public.complete_onboarding_session_step"),
        onboardingOperations.indexOf("create or replace function public.complete_relationship_onboarding_session")
    )
    const predecessorGuard = stepRpc.indexOf("snapshot_step.sort_order < v_step.sort_order")
    const assetWrite = stepRpc.indexOf("insert into public.assets")
    assert.ok(predecessorGuard >= 0 && predecessorGuard < assetWrite)
    assert.match(stepRpc, /predecessor\.status <> 'done'/u)
    assert.match(canonical, /publicOnboardingMutationMessage/u)
})

test("test clients autofill the frozen current form and advance without legacy field assumptions", () => {
    assert.match(publicActions, /const step = resolved\.completableSteps\.find/u)
    assert.match(publicActions, /createTestFormResponse\(form, draft\?\.response\)/u)
    assert.match(publicActions, /submitCanonicalFormStep\(token, stepKey, response, \{[\s\S]{0,120}allowMissingRequiredFilesForTest: true/u)
    assert.match(canonical, /allowMissingRequiredFiles: Boolean\(options\.allowMissingRequiredFilesForTest && resolved\.session\.is_test\)/u)
    assert.match(canonical, /field\.required && uploads\.length === 0 && !options\.allowMissingRequiredFiles/u)
    assert.doesNotMatch(publicActions, /Test response for/u)
    assert.doesNotMatch(publicActions, /if \(formKey\)/u)
    assert.match(publicPage, /skipTestStep\(token, currentStep\.key\)/u)
})

test("test clients can skip steps with unsatisfied mandatory runtime blocks", () => {
    assert.match(publicActions, /if \(!session\.is_test\) throw new Error\("Invalid test onboarding session"\)/u)
    assert.match(testBlockSkipMigration, /join public\.relationship_onboarding_sessions session/u)
    assert.match(testBlockSkipMigration, /session\.id = block\.session_id/u)
    assert.match(testBlockSkipMigration, /and not session\.is_test/u)
    assert.match(testBlockSkipMigration, /Complete the required video or link before continuing\./u)
})

test("paid consent queues one idempotent onboarding-link delivery after consent persistence", () => {
    const handler = saleAutomation.slice(saleAutomation.indexOf("export async function handleSaleConsentConfirmation"))
    const enqueueIndex = handler.indexOf("enqueueOnboardingLinkDelivery({")
    const inboundIndex = handler.indexOf('status: "whatsapp_consent_confirmed"')
    const manualReturnIndex = handler.indexOf(
        "return { handled: true, ok: true }",
        handler.indexOf('if (flow === "manual_migration")', inboundIndex)
    )
    assert.ok(inboundIndex >= 0 && inboundIndex < enqueueIndex)
    assert.ok(manualReturnIndex >= 0 && manualReturnIndex < enqueueIndex)
    assert.match(saleAutomation, /rpc\("enqueue_onboarding_link_delivery"/u)
    assert.match(saleAutomation, /p_idempotency_key:\s*`onboarding-link:\$\{input\.sale\.id\}`/u)
    assert.ok(enqueueIndex < handler.indexOf("sendLegacyOnboardingLink({"))
    assert.match(onboardingOperations, /where workspace_id = p_workspace_id and idempotency_key = trim\(p_idempotency_key\)/u)
    assert.match(onboardingOperations, /set status = 'onboarding_link_sent'/u)
    assert.match(onboardingOperations, /set status = 'onboarding_link_failed'/u)
    assert.match(onboardingOperations, /update public\.client_messages[\s\S]+raw_payload @> jsonb_build_object\('outbox_id', v_outbox\.id\)/u)
})

test("relationship archive releases WhatsApp confirmation matching while preserving history", () => {
    assert.match(relationshipActions, /rpc\("archive_workspace_relationship"/u)
    assert.match(relationshipArchive, /set status = 'archived', lifecycle_phase = 'completed_lost'/u)
    assert.doesNotMatch(relationshipArchive, /delete from/u)
    assert.doesNotMatch(relationshipArchive, /update public\.client_sales/u)
    assert.match(saleAutomation, /firstUnarchivedRelationshipSale/u)
    assert.match(saleAutomation, /statusById\.get\(candidate\.relationship_id\) !== "archived"/u)
    assert.match(relationshipArchiveFix, /'onboarding',[\s\S]+relationship\.archived/u)
    assert.doesNotMatch(relationshipArchiveFix, /'relationships'/u)
    assert.match(relationshipActions, /reportPlatformFailure/u)
    assert.match(archiveRelationshipForm, /WORKSPACE_TAB_FRAME_PARAM/u)
    assert.match(archiveRelationshipForm, /data-global-loading="false"/u)
    assert.match(relationshipActions, /workspaceTabFrameUrl\(relationshipsHref, tabId/u)
})

test("outbox retry route fails closed and never returns queue payloads", () => {
    assert.match(outboxRoute, /if \(!secret/u)
    assert.match(outboxRoute, /timingSafeEqual/u)
    assert.match(outboxRoute, /processAllOnboardingOutboxes/u)
    assert.doesNotMatch(outboxRoute, /payload:/u)
    assert.match(environmentExample, /CRON_SECRET=/u)
    assert.match(environmentExample, /cron-job\.org onboarding outbox scheduler/u)
    assert.match(readme, /cron-job\.org[\s\S]+every 15 minutes/u)
    assert.match(readme, /Custom header name: `Authorization`/u)
    assert.match(readme, /Do not register[\s\S]+Vercel Cron Job/u)
})

test("publishing wakes the scoped outbox only after a successful publish result", () => {
    const publishAction = builderActions.slice(builderActions.indexOf("export async function publishOnboardingModule"), builderActions.indexOf("async function setModuleArchiveState"))
    assert.ok(publishAction.indexOf('configurationRpc<PublishedModuleResult>("publish_onboarding_module"') < publishAction.indexOf("if (outcome.ok)"))
    assert.ok(publishAction.indexOf("if (outcome.ok)") < publishAction.indexOf("processWorkspaceOnboardingOutbox"))
    assert.match(publishAction, /try \{[\s\S]+processWorkspaceOnboardingOutbox[\s\S]+\} catch \{/u)
})

test("outbox diagnostics redact URLs, tokens, credentials, and client phone numbers", () => {
    const sanitized = sanitizeOnboardingOutboxError(
        "Authorization: Bearer abc access_token=secret-value https://example.test/onboarding/0123456789abcdef0123456789abcdef +353 89 123 4567"
    )
    assert.doesNotMatch(sanitized, /secret-value|example\.test|0123456789abcdef|353 89/u)
    assert.match(sanitized, /\[redacted\]|\[url\]|\[token\]|\[number\]/u)
})

test("upload acceptance is strict, document-aware, and rejects empty or oversized files", () => {
    const imageField = { label: "Logo", accept: "image" as const }
    const videoField = { label: "Walkthrough", accept: "video" as const }
    const documentField = { label: "Brief", accept: "document" as const }
    const anyField = { label: "Attachment", accept: "any" as const }

    assert.doesNotThrow(() => validateOnboardingUploadFile(imageField, { name: "logo.png", size: 1, type: "image/png" }))
    assert.throws(() => validateOnboardingUploadFile(imageField, { name: "brief.pdf", size: 1, type: "application/pdf" }), /accepts image files/u)
    assert.doesNotThrow(() => validateOnboardingUploadFile(videoField, { name: "tour.mp4", size: 1, type: "video/mp4" }))
    assert.throws(() => validateOnboardingUploadFile(videoField, { name: "logo.png", size: 1, type: "image/png" }), /accepts video files/u)
    assert.doesNotThrow(() => validateOnboardingUploadFile(documentField, { name: "brief.docx", size: 1, type: "" }))
    assert.doesNotThrow(() => validateOnboardingUploadFile(documentField, { name: "brief", size: 1, type: "application/pdf" }))
    assert.throws(() => validateOnboardingUploadFile(documentField, { name: "archive.zip", size: 1, type: "application/zip" }), /accepts document files/u)
    assert.throws(() => validateOnboardingUploadFile(anyField, { name: "empty.txt", size: 0, type: "text/plain" }), /valid file/u)
    assert.throws(() => validateOnboardingUploadFile(anyField, { name: "large.bin", size: MAX_ONBOARDING_UPLOAD_SIZE + 1, type: "application/octet-stream" }), /500MB/u)
    assert.equal(getFileAcceptValue("image"), "image/*")
    assert.match(publicActions, /validateOnboardingUploadFile\(field, file\)/u)
    assert.match(canonical, /if \(!field\.multiple && uploads\.length > 1\)/u)
})

test("draft autosave serializes requests, collapses to the latest response, and never marks stale saves complete", () => {
    assert.match(onboardingForm, /draftQueueRef/u)
    assert.match(onboardingForm, /draftPumpRef/u)
    assert.match(onboardingForm, /if \(draftPumpRef\.current\) return draftPumpRef\.current/u)
    assert.match(onboardingForm, /while \(draftQueueRef\.current\)/u)
    assert.match(onboardingForm, /draftVersionRef\.current === pending\.version/u)
    assert.match(onboardingForm, /window\.addEventListener\("online", retry\)/u)
    assert.ok(onboardingForm.indexOf("await draftPumpRef.current") < onboardingForm.indexOf("const formData = new FormData(event.currentTarget)"))
})
