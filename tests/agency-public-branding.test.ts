import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync("supabase/migrations/20260904140000_workspace_public_branding.sql", "utf8")
const settings = readFileSync("app/[workspaceSlug]/settings/page.tsx", "utf8")
const settingsFields = readFileSync("components/settings/AgencyPublicBrandingFields.tsx", "utf8")
const settingsActions = readFileSync("app/[workspaceSlug]/settings/branding-actions.ts", "utf8")
const publicBranding = readFileSync("lib/client-branding/public-branding.ts", "utf8")
const smsPage = readFileSync("app/onboarding/smsoptin/page.tsx", "utf8")
const onboardingPage = readFileSync("app/onboarding/session/[token]/page.tsx", "utf8")
const portalPage = readFileSync("app/client-portal/session/[token]/page.tsx", "utf8")
const onboardingLayout = readFileSync("components/onboarding/OnboardingLayout.tsx", "utf8")
const mobileStepBar = readFileSync("components/onboarding/MobileStepBar.tsx", "utf8")
const portalShell = readFileSync("components/client-portal/ClientPortalShell.tsx", "utf8")
const portalChat = readFileSync("components/client-portal/ClientPortalChat.tsx", "utf8")
const smsConsent = readFileSync("lib/client-sales/sms-consent.ts", "utf8")
const outbox = readFileSync("lib/onboarding/outbox.ts", "utf8")
const twilioWebhook = readFileSync("app/api/client-messages/twilio/route.ts", "utf8")

test("Agency Branding stores a public name, direct policy destinations, and metadata options", () => {
    for (const column of [
        "agency_display_name",
        "agency_privacy_policy_url",
        "agency_terms_of_service_url",
        "agency_metadata_title",
        "agency_metadata_description",
    ]) {
        assert.match(migration, new RegExp(`add column if not exists ${column}`, "u"))
        assert.match(settingsFields, new RegExp(`name="${column}"`, "u"))
        assert.match(settingsActions, new RegExp(`${column}:`, "u"))
    }
    assert.match(settings, /<AgencyPublicBrandingFields/u)
    assert.match(settingsActions, /requireWorkspace\(slug, "admin"\)/u)
    assert.match(settingsActions, /url\.protocol !== "https:"/u)
})
test("agency pages emit agency-owned titles, descriptions, and direct policy anchors", () => {
    assert.match(publicBranding, /const title = `\$\{siteTitle\} \$\{label\}`/u)
    assert.match(publicBranding, /applicationName: siteTitle/u)
    assert.match(publicBranding, /openGraph:/u)
    assert.match(publicBranding, /twitter:/u)
    assert.match(publicBranding, /alternates: canonicalUrl/u)
    assert.match(smsPage, /agencyBrandedMetadata\(workspace\?\.branding \?\? null, "sms-opt-in"/u)
    assert.match(onboardingPage, /agencyBrandedMetadata\(branding, "onboarding"/u)
    assert.match(portalPage, /agencyBrandedMetadata\(branding, "client-portal"/u)
    for (const page of [smsPage, onboardingLayout, mobileStepBar, portalShell]) {
        assert.match(page, /href=\{privacyPolicyUrl\}/u)
        assert.match(page, /href=\{termsOfServiceUrl\}/u)
        assert.doesNotMatch(page, /betelgeze\.com/u)
    }
})

test("the public display name replaces workspace and platform names across client-facing messaging", () => {
    assert.match(publicBranding, /displayName: optionalText\(row\?\.agency_display_name\) \?\? workspaceName/u)
    assert.match(onboardingPage, /workspaceName=\{publicBranding\.displayName\}/u)
    assert.match(portalPage, /workspaceName=\{publicBranding\.displayName\}/u)
    assert.match(smsConsent, /disclosureFor\(workspace\.branding\.displayName\)/u)
    assert.match(smsConsent, /`\$\{branding\.displayName\}: You're opted in/u)
    assert.match(outbox, /workspaceName: publicBranding\.displayName/u)
    assert.match(twilioWebhook, /branding\?\.displayName \?\? "Your agency"/u)
    assert.doesNotMatch(portalChat, /in Betelgeze/u)
})
