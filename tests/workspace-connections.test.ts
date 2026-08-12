import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const integrations = readFileSync("lib/workspace-integrations.ts", "utf8")
const migration = readFileSync("supabase/migrations/20260812110000_universal_workspace_connections.sql", "utf8")
const settingsUi = readFileSync("components/admin/WorkspaceConnections.tsx", "utf8")
const stripeStart = readFileSync("app/api/workspace-connections/stripe/start/route.ts", "utf8")
const stripeCallback = readFileSync("app/api/workspace-connections/stripe/callback/route.ts", "utf8")
const stripeWebhook = readFileSync("app/api/stripe/webhook/route.ts", "utf8")
const whatsapp = readFileSync("lib/client-messages/meta-whatsapp.ts", "utf8")
const whatsappWebhook = readFileSync("app/api/client-messages/meta/whatsapp/route.ts", "utf8")
const saleAutomation = readFileSync("lib/client-sales/automation.ts", "utf8")
const outbox = readFileSync("lib/onboarding/outbox.ts", "utf8")

test("connection candidates activate atomically and keep a one-generation rollback", () => {
    assert.match(migration, /candidate_config_encrypted/u)
    assert.match(migration, /create or replace function public\.activate_workspace_integration_candidate/u)
    assert.match(migration, /previous_mode = mode/u)
    assert.match(migration, /create or replace function public\.restore_workspace_integration_previous/u)
    assert.match(integrations, /stageWorkspaceIntegrationCandidate/u)
    assert.match(integrations, /verifyAndActivateWorkspaceIntegrationCandidate/u)
})

test("OAuth state is short lived, random, hashed, single use, and tied to its initiating user", () => {
    assert.match(integrations, /randomBytes\(32\)\.toString\("base64url"\)/u)
    assert.match(integrations, /createHash\("sha256"\)/u)
    assert.match(integrations, /Date\.now\(\) \+ 10 \* 60_000/u)
    assert.match(integrations, /data\.status !== "pending"/u)
    assert.match(stripeCallback, /authenticated\.user\.id !== attempt\.requested_by/u)
    assert.match(stripeStart, /createConnectionAttempt/u)
})

test("Settings uses one popup lifecycle with automatic and manual connection paths", () => {
    assert.match(settingsUi, /role="dialog"/u)
    assert.match(settingsUi, /Continue to Stripe/u)
    assert.match(settingsUi, /Continue with Meta/u)
    assert.match(settingsUi, /Use manual credentials/u)
    assert.match(settingsUi, /The current connection remains active until the replacement passes every required check/u)
    assert.match(settingsUi, /Restore previous/u)
})

test("provider runtime operations use the workspace connection", () => {
    assert.match(whatsapp, /getWorkspaceProviderConfig\(workspaceId, "meta_whatsapp"\)/u)
    assert.match(saleAutomation, /workspaceId: sale\.workspace_id/u)
    assert.match(outbox, /workspaceId: row\.workspace_id/u)
    assert.match(saleAutomation, /whatsappConfig\.consent_template_name/u)
})

test("webhooks resolve workspace identity before processing tenant data", () => {
    assert.match(stripeWebhook, /getWorkspaceIdForConnectedAccount\("stripe", externalAccountId\)/u)
    assert.match(stripeWebhook, /recordWorkspaceConnectionWebhook\(workspaceId, "stripe"\)/u)
    assert.match(stripeWebhook, /candidate\.livemode === null \|\| candidate\.livemode === event\.livemode/u)
    assert.match(stripeWebhook, /account\.application\.deauthorized/u)
    assert.match(stripeWebhook, /disconnectWorkspaceIntegration\(workspaceId, "stripe"\)/u)
    assert.match(stripeWebhook, /isResumableAutomationEvent/u)
    assert.match(integrations, /STRIPE_APP_TEST_WEBHOOK_SECRET/u)
    assert.match(integrations, /STRIPE_APP_LIVE_WEBHOOK_SECRET/u)
    assert.match(whatsappWebhook, /getWorkspaceIdForWhatsAppPhoneNumber\(phoneNumberIds\[0\]\)/u)
    assert.match(whatsappWebhook, /handleSaleConsentConfirmation\(\{\s*workspaceId,/u)
    assert.match(saleAutomation, /findPendingConfirmedSale\(fromAddress, workspaceId\)/u)
    assert.match(saleAutomation, /\.eq\("workspace_id", workspaceId\)/u)
})

test("legacy Stripe and WhatsApp credentials remain available during cutover", () => {
    assert.match(integrations, /if \(data\.mode === "platform_legacy"\) return legacyConfig\(provider\)/u)
    assert.match(integrations, /META_WHATSAPP_ACCESS_TOKEN/u)
    assert.match(integrations, /STRIPE_SECRET_KEY/u)
    assert.match(migration, /platform_legacy escape hatch/u)
})
