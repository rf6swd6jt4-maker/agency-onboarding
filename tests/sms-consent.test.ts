import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync("supabase/migrations/20260903120000_relationship_sms_consent.sql", "utf8")
const consentPage = readFileSync("app/onboarding/sms-consent/page.tsx", "utf8")
const consentForm = readFileSync("components/onboarding/SmsConsentForm.tsx", "utf8")
const consent = readFileSync("lib/client-sales/sms-consent.ts", "utf8")
const consentState = readFileSync("lib/client-sales/sms-consent-state.ts", "utf8")
const relationshipActions = readFileSync("app/[workspaceSlug]/relationships/actions.ts", "utf8")
const relationshipPage = readFileSync("app/[workspaceSlug]/relationships/[relationshipId]/page.tsx", "utf8")
const omnichannel = readFileSync("lib/client-messages/omnichannel.ts", "utf8")
const saleAutomation = readFileSync("lib/client-sales/automation.ts", "utf8")
const outbox = readFileSync("lib/onboarding/outbox.ts", "utf8")
const twilioWebhook = readFileSync("app/api/client-messages/twilio/route.ts", "utf8")
const proxy = readFileSync("proxy.ts", "utf8")

test("sold-client SMS consent uses an opaque token and retains auditable web consent", () => {
    assert.match(migration, /sms_consent_token text/u)
    assert.match(migration, /gen_random_bytes\(32\)/u)
    assert.match(migration, /create table if not exists public\.relationship_sms_consents/u)
    assert.match(migration, /disclosure_text text not null/u)
    assert.match(migration, /consented_at timestamptz not null/u)
    assert.match(migration, /source_url text not null/u)
    assert.match(migration, /workspace_user_can_access_relationship\(workspace_id, relationship_id\)/u)
})

test("public opt-in is explicit, optional to purchase, and re-verifies the saved phone", () => {
    assert.match(consentPage, /SMS consent/u)
    assert.match(consentForm, /name="phone"/u)
    assert.match(consentForm, /name="sms_consent" type="checkbox" value="yes" required/u)
    assert.doesNotMatch(consentForm, /defaultChecked|checked=/u)
    assert.match(consentForm, /Message frequency varies/u)
    assert.match(consentForm, /Msg &amp; data rates may apply/u)
    assert.match(consentForm, /Reply HELP for help or STOP to opt out/u)
    assert.match(consentForm, /Consent is not a condition of purchase/u)
    assert.match(consent, /submittedPhone !== expectedPhone/u)
    assert.match(consentPage, /https:\/\/www\.betelgeze\.com\/privacy/u)
    assert.match(consentPage, /https:\/\/www\.betelgeze\.com\/terms/u)
})

test("verified custom onboarding domains expose the same consent page", () => {
    assert.match(proxy, /workspace\.surface === "onboarding" && path === "\/sms-consent"/u)
    assert.match(proxy, /withRewrite\(request, "\/onboarding\/sms-consent", headers\)/u)
    assert.match(consent, /customDomainVerified/u)
    assert.match(consent, /searchParams\.set\("token", input\.token\)/u)
})

test("web opt-in sends sample one and CONFIRM queues sample two", () => {
    assert.match(consent, /You're opted in to receive SMS messages related to your client onboarding/u)
    assert.match(consent, /Reply CONFIRM to receive your secure onboarding link/u)
    assert.match(consent, /smsConsentContext: "web_opt_in"/u)
    assert.match(saleAutomation, /smsConsentForConfirmation/u)
    assert.match(saleAutomation, /markSmsConsentConfirmed/u)
    assert.match(outbox, /Thanks for confirming\. Complete your onboarding here:/u)
    assert.match(outbox, /Reply HELP for help or STOP to opt out/u)
})

test("SMS delivery is consent gated and STOP is retained without duplicate Advanced Opt-Out replies", () => {
    assert.match(omnichannel, /smsConsentAllowsDelivery/u)
    assert.match(omnichannel, /has not opted in to SMS messages for this relationship/u)
    assert.match(consentState, /status: "opted_out"/u)
    assert.match(twilioWebhook, /OptOutType/u)
    assert.match(twilioWebhook, /recordSmsOptOut/u)
    assert.match(twilioWebhook, /if \(optOutType === "HELP"\) return twimlResponse\(\)/u)
})

test("selling a Twilio relationship creates a shareable consent link instead of sending unsolicited SMS", () => {
    assert.match(relationshipActions, /if \(sale\.requiresSmsConsent\)/u)
    assert.match(relationshipActions, /getSmsConsentUrl/u)
    assert.match(relationshipActions, /kind: "sms_consent"/u)
    assert.match(relationshipPage, /Copy SMS consent link/u)
    assert.match(relationshipPage, /share this secure web link outside SMS/i)
})
