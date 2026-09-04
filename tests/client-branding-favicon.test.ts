import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { validateClientLogoSvg } from "../lib/client-branding/svg.ts"

const migration = readFileSync("supabase/migrations/20260904150000_workspace_client_brand_assets.sql", "utf8")
const branding = readFileSync("components/settings/AgencyBrandingEditor.tsx", "utf8")
const settings = readFileSync("app/[workspaceSlug]/settings/page.tsx", "utf8")
const settingsActions = readFileSync("app/[workspaceSlug]/settings/branding-actions.ts", "utf8")
const assets = readFileSync("lib/client-branding/assets.ts", "utf8")
const faviconRoute = readFileSync("app/api/client-branding/favicon/[surface]/[token]/route.ts", "utf8")
const logoRoute = readFileSync("app/api/client-branding/logo/[surface]/[token]/route.ts", "utf8")
const onboarding = readFileSync("app/onboarding/session/[token]/page.tsx", "utf8")
const onboardingLayout = readFileSync("components/onboarding/OnboardingLayout.tsx", "utf8")
const portal = readFileSync("app/client-portal/session/[token]/page.tsx", "utf8")
const portalShell = readFileSync("components/client-portal/ClientPortalShell.tsx", "utf8")
const smsOptIn = readFileSync("app/onboarding/smsoptin/page.tsx", "utf8")
const manifest = readFileSync("public/manifest.webmanifest", "utf8")
const rootLayout = readFileSync("app/layout.tsx", "utf8")

test("Agency Branding stores separate public logo and favicon assets", () => {
    assert.match(migration, /add column if not exists agency_logo_path text/u)
    assert.match(migration, /add column if not exists agency_favicon_path text/u)
    assert.match(migration, /client-branding\/logo/u)
    assert.match(migration, /client-branding\/favicon/u)
    assert.match(branding, /Client-facing artwork/u)
    assert.match(branding, /name=\{inputName\}/u)
    assert.match(branding, /inputName="agency_logo"/u)
    assert.match(branding, /inputName="agency_favicon"/u)
    assert.match(branding, /accept="image\/svg\+xml,\.svg"/u)
    assert.match(settings, /uploadLogo=\{uploadAgencyLogo\.bind/u)
    assert.match(settings, /uploadFavicon=\{uploadAgencyFavicon\.bind/u)
    assert.match(settingsActions, /agency_logo_path/u)
    assert.match(settingsActions, /agency_favicon_path/u)
})

test("agency SVG logos are self-contained and scalable", () => {
    const safe = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 30"><path d="M0 0h120v30H0z"/></svg>')
    assert.match(validateClientLogoSvg(safe), /viewBox/u)
    for (const unsafe of [
        '<svg viewBox="0 0 10 10"><script>alert(1)</script></svg>',
        '<svg viewBox="0 0 10 10" onload="alert(1)"></svg>',
        '<svg viewBox="0 0 10 10"><image href="https://example.com/a.png"/></svg>',
        '<svg><path d="M0 0"/></svg>',
    ]) {
        assert.throws(() => validateClientLogoSvg(new TextEncoder().encode(unsafe)))
    }
})

test("all public client surfaces use the agency logo and favicon", () => {
    assert.match(onboarding, /clientFaviconIcons\("onboarding", token\)/u)
    assert.match(onboarding, /clientBrandLogoUrl\("onboarding", token/u)
    assert.match(onboarding, /logoSrc=\{logoSrc\}/u)
    assert.match(onboardingLayout, /<ClientBrandLogo logoSrc=\{logoSrc\}/u)
    assert.match(portal, /clientFaviconIcons\("client-portal", token\)/u)
    assert.match(portal, /clientBrandLogoUrl\("client-portal", token/u)
    assert.match(portalShell, /<ClientBrandLogo logoSrc=\{logoSrc\}/u)
    assert.match(smsOptIn, /clientFaviconIcons\("sms-opt-in", workspace\.slug\)/u)
    assert.match(smsOptIn, /clientBrandLogoUrl\("sms-opt-in", workspace\.slug/u)
    assert.match(smsOptIn, /<ClientBrandLogo logoSrc=\{logoSrc\}/u)
    assert.match(assets, /"onboarding" \| "client-portal" \| "sms-opt-in"/u)
})

test("public asset endpoints are same-origin, immutable, and keep the staff manifest unchanged", () => {
    assert.match(assets, /`\/api\/client-branding\/\$\{kind\}\/\$\{surface\}/u)
    assert.match(assets, /validLegacyFaviconPath/u)
    assert.match(faviconRoute, /resize\(64, 64/u)
    assert.match(faviconRoute, /Content-Type": "image\/png"/u)
    assert.match(logoRoute, /Content-Type": "image\/svg\+xml; charset=utf-8"/u)
    assert.match(logoRoute, /Content-Security-Policy/u)
    assert.match(faviconRoute + logoRoute, /max-age=31536000, immutable/u)
    assert.match(manifest, /betelgeze-icon-192\.png/u)
    assert.match(manifest, /betelgeze-icon-512\.png/u)
    assert.match(rootLayout, /icon: "\/icon\.svg\?v=20260624"/u)
})
