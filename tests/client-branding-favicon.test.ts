import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const branding = readFileSync("components/settings/AgencyBrandingEditor.tsx", "utf8")
const settings = readFileSync("app/[workspaceSlug]/settings/page.tsx", "utf8")
const favicon = readFileSync("lib/client-branding/favicon.ts", "utf8")
const route = readFileSync("app/api/client-branding/favicon/[surface]/[token]/route.ts", "utf8")
const onboarding = readFileSync("app/onboarding/session/[token]/page.tsx", "utf8")
const portal = readFileSync("app/client-portal/session/[token]/page.tsx", "utf8")
const manifest = readFileSync("public/manifest.webmanifest", "utf8")
const rootLayout = readFileSync("app/layout.tsx", "utf8")
const publicIcon = readFileSync("public/icon.svg", "utf8")

test("Agency Branding exposes the workspace logo as the shared client favicon", () => {
    assert.match(branding, /Client-facing favicon/u)
    assert.match(branding, /name="logo"/u)
    assert.match(settings, /faviconSrc=\{logoSrc\}/u)
    assert.match(settings, /uploadFavicon=\{uploadWorkspaceLogo\.bind/u)
})

test("onboarding and client portal metadata select token-scoped favicon URLs", () => {
    assert.match(onboarding, /clientFaviconIcons\("onboarding", token\)/u)
    assert.match(portal, /clientFaviconIcons\("client-portal", token\)/u)
    assert.match(favicon, /relationship_onboarding_sessions/u)
    assert.match(favicon, /client_portal_sessions/u)
    assert.match(favicon, /logo_path/u)
    assert.match(favicon, /\/api\/client-branding\/favicon\/\$\{surface\}\/\$\{token\.toLowerCase\(\)\}/u)
})

test("the public favicon endpoint returns a normalized cache-busted PNG without changing the staff manifest", () => {
    assert.match(route, /resize\(64, 64/u)
    assert.match(route, /Content-Type": "image\/png"/u)
    assert.match(route, /max-age=31536000, immutable/u)
    assert.match(manifest, /betelgeze-icon-192\.png/u)
    assert.match(manifest, /betelgeze-icon-512\.png/u)
    assert.match(rootLayout, /icon: "\/icon\.svg\?v=20260624"/u)
    assert.match(publicIcon, /rotate\(45 128 128\)/u)
})
