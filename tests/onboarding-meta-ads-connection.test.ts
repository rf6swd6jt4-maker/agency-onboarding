import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { createConnectionBlock } from "../lib/onboarding/block-definition.ts"

const runtime = readFileSync("components/onboarding/OnboardingBlocks.tsx", "utf8")
const builder = readFileSync("components/onboarding-builder/OnboardingBuilderWorkspace.tsx", "utf8")
const start = readFileSync("app/api/onboarding/session/[token]/meta-ads/start/route.ts", "utf8")
const callback = readFileSync("app/api/onboarding/meta-ads/callback/route.ts", "utf8")
const migration = readFileSync("supabase/migrations/20260830170000_onboarding_meta_ads_connections.sql", "utf8")

test("the Builder exposes a required Facebook connection block", () => {
    const block = createConnectionBlock()
    assert.equal(block.kind, "connection")
    assert.equal(block.provider, "meta_ads")
    assert.equal(block.label, "Connect Facebook")
    assert.equal(block.required, true)
    assert.match(builder, /Facebook connection/u)
    assert.match(runtime, /Facebook connected/u)
})

test("client OAuth is short lived, single use, and bound to the onboarding block", () => {
    assert.match(start, /randomBytes\(32\)\.toString\("base64url"\)/u)
    assert.match(start, /createHash\("sha256"\)/u)
    assert.match(start, /Date\.now\(\) \+ 10 \* 60_000/u)
    assert.match(start, /\.eq\("session_id", resolved\.session\.id\)/u)
    assert.match(start, /workspaceConnection\.connection_status !== "connected"/u)
    assert.match(callback, /\.is\("used_at", null\)/u)
    assert.match(callback, /\.gt\("expires_at"/u)
})

test("successful Facebook authorization is relationship scoped and completes the real requirement", () => {
    assert.match(migration, /relationship_meta_ads_connections/u)
    assert.match(migration, /unique \(workspace_id, relationship_id\)/u)
    assert.match(migration, /credential_encrypted/u)
    assert.match(callback, /encryptIntegrationCredential/u)
    assert.match(callback, /getMetaAdsBusinessOptions/u)
    assert.match(callback, /getMetaAdsAdAccountOptions/u)
    assert.match(callback, /requirement_kind: "meta_ads_connected"/u)
    assert.doesNotMatch(runtime, /satisfyBlockRequirement\(token, block\.sessionBlockId, "meta_ads_connected"\)/u)
})
