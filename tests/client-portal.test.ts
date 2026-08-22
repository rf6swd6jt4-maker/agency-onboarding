import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync("supabase/migrations/20260822090000_client_portal_foundation.sql", "utf8")
const testDeliveryFix = readFileSync("supabase/migrations/20260822110000_deliver_test_client_portal_links.sql", "utf8")
const proxy = readFileSync("proxy.ts", "utf8")
const portalPage = readFileSync("app/client-portal/session/[token]/page.tsx", "utf8")
const portalSession = readFileSync("lib/client-portal/session.ts", "utf8")
const portalDomain = readFileSync("lib/client-portal/domain.ts", "utf8")
const onboardingRuntime = readFileSync("lib/onboarding/canonical.ts", "utf8")
const onboardingActions = readFileSync("app/onboarding/session/[token]/actions.ts", "utf8")
const onboardingForm = readFileSync("components/onboarding/OnboardingForm.tsx", "utf8")
const outbox = readFileSync("lib/onboarding/outbox.ts", "utf8")
const settings = readFileSync("app/[workspaceSlug]/settings/page.tsx", "utf8")
const settingsActions = readFileSync("app/[workspaceSlug]/settings/actions.ts", "utf8")

test("client portal sessions are durable relationship credentials provisioned by onboarding completion", () => {
    assert.match(migration, /create table if not exists public\.client_portal_sessions/u)
    assert.match(migration, /unique \(workspace_id, relationship_id\)/u)
    assert.match(migration, /session_token ~ '\^\[a-f0-9\]\{64\}\$'/u)
    assert.match(migration, /after update of status on public\.relationship_onboarding_sessions/u)
    assert.match(migration, /new\.status = 'completed'/u)
    assert.match(migration, /on conflict \(workspace_id, relationship_id\) do update/u)
    assert.match(testDeliveryFix, /create or replace function public\.provision_client_portal_after_onboarding/u)
    assert.doesNotMatch(testDeliveryFix, /new\.is_test/u)
})

test("completion queues one idempotent portal link through the existing omnichannel outbox", () => {
    assert.match(migration, /'client_portal_link'/u)
    assert.match(migration, /'client-portal-link:' \|\| new\.id::text/u)
    assert.match(migration, /portal_session_id/u)
    assert.match(outbox, /row\.kind === "client_portal_link"/u)
    assert.match(outbox, /getClientPortalUrl/u)
    assert.match(outbox, /sendCommunicationDeliveries/u)
    assert.match(outbox, /Client portal link/u)
})

test("portal custom domains have independent settings, verification, and routing", () => {
    assert.match(migration, /custom_client_portal_domain_status/u)
    assert.match(migration, /resolve_workspace_public_domain/u)
    assert.match(migration, /'client_portal'::text/u)
    assert.match(proxy, /resolve_workspace_public_domain/u)
    assert.match(proxy, /x-betelgeze-custom-client-portal-domain/u)
    assert.match(proxy, /`\/client-portal\/session\/\$\{customToken\[1\]\}`/u)
    assert.match(portalDomain, /customDomainVerified/u)
    assert.match(settings, /surface="client_portal"/u)
    assert.match(settings, /id="client-portal-domain"/u)
})

test("client portal settings expose the onboarding-equivalent domain process to owners and admins", () => {
    const portalSection = settings.indexOf('id="client-portal"')
    const portalDomain = settings.indexOf('id="client-portal-domain"')
    const connectionsSection = settings.indexOf('id="connections"')
    assert.ok(portalSection >= 0 && portalDomain > portalSection && connectionsSection > portalDomain)
    assert.match(settings, /surface="client_portal"[\s\S]*canManage=\{role === "owner" \|\| role === "admin"\}/u)
    assert.match(settingsActions, /saveWorkspaceClientPortalDomain[\s\S]*requireWorkspace\(slug, "admin"\)/u)
    assert.match(settingsActions, /verifyWorkspaceClientPortalDomain[\s\S]*requireWorkspace\(slug, "admin"\)/u)
    assert.match(settingsActions, /cancelWorkspaceClientPortalDomain[\s\S]*requireWorkspace\(slug, "admin"\)/u)
})

test("completed onboarding redirects to a branded portal with a safe invalid-link probe", () => {
    assert.match(onboardingRuntime, /getClientPortalUrlForOnboardingSession/u)
    assert.match(onboardingActions, /redirect\(outcome\.clientPortalUrl\)/u)
    assert.match(onboardingForm, /window\.location\.assign\(outcome\.clientPortalUrl\)/u)
    assert.match(portalSession, /loadPublishedOnboardingConfiguration/u)
    assert.match(portalSession, /\.neq\("status", "archived"\)/u)
    assert.doesNotMatch(portalSession, /\.is\("archived_at"/u)
    assert.match(portalPage, /<OnboardingThemeProvider theme=\{theme\}>/u)
    assert.match(portalPage, /var\(--onboarding-primary/u)
    assert.match(portalPage, /data-betelgeze-client-portal-session="invalid"/u)
    assert.match(portalPage, /Onboarding complete/u)
})
