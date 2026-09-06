import assert from "node:assert/strict"
import { generateKeyPairSync, verify } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"
import { googleAdsConfigFromForm, normalizeGoogleAdsConfig, verifyGoogleAdsManager } from "../lib/google-ads.ts"

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 })
const config = {
    manager_customer_id: "123-456-7890",
    developer_token: "A".repeat(22),
    client_email: "reporting@example.iam.gserviceaccount.com",
    private_key: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
}
const manager = { id: "1234567890", descriptiveName: "Agency", manager: true, currencyCode: "EUR", timeZone: "Europe/Dublin" }

function googleResponses(customer: object = manager, failure?: { status: number; payload: unknown }) {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetcher: typeof fetch = async (url, init) => {
        calls.push({ url: String(url), init: init! })
        return calls.length === 1
            ? Response.json({ access_token: "test-access-token" })
            : failure ? Response.json(failure.payload, { status: failure.status }) : Response.json({ results: [{ customer }] })
    }
    return { calls, fetcher }
}

test("Google manager verification signs a valid assertion and queries only the selected manager", async () => {
    const { calls, fetcher } = googleResponses()
    const hint = await verifyGoogleAdsManager(config, fetcher)
    assert.equal(hint.manager_customer_id, "1234567890")
    assert.equal(hint.manager_name, "Agency")
    assert.deepEqual(hint.capabilities, { manager_access: true, production_api_access: true })
    assert.equal(calls.length, 2)
    assert.equal(calls[0].url, "https://oauth2.googleapis.com/token")
    const params = calls[0].init.body as URLSearchParams
    const [header, claims, signature] = params.get("assertion")!.split(".")
    assert.equal(verify("RSA-SHA256", Buffer.from(`${header}.${claims}`), keys.publicKey, Buffer.from(signature, "base64url")), true)
    const payload = JSON.parse(Buffer.from(claims, "base64url").toString())
    assert.equal(payload.iss, config.client_email)
    assert.equal(payload.aud, calls[0].url)
    assert.equal(payload.scope, "https://www.googleapis.com/auth/adwords")
    assert.equal(payload.exp - payload.iat, 3600)
    assert.equal(calls[1].url, "https://googleads.googleapis.com/v25/customers/1234567890/googleAds:search")
    assert.equal(new Headers(calls[1].init.headers).get("login-customer-id"), "1234567890")
    assert.match(String(calls[1].init.body), /FROM customer LIMIT 1/)
    assert.ok(calls.every((call) => call.init.cache === "no-store" && call.init.redirect === "error" && call.init.signal))
    assert.doesNotMatch(JSON.stringify(hint), /test-access-token|PRIVATE KEY|AAAAAAAA/)
})

test("verification rejects client accounts, test managers, and mismatched identities", async () => {
    for (const [customer, message] of [
        [{ ...manager, manager: false }, /not a manager/],
        [{ ...manager, testAccount: true }, /test manager/],
        [{ ...manager, id: "9999999999" }, /requested manager/],
    ] as const) {
        await assert.rejects(verifyGoogleAdsManager(config, googleResponses(customer).fetcher), message)
    }
})

test("Google errors give actionable guidance without returning provider secrets", async () => {
    for (const [code, message] of [
        ["DEVELOPER_TOKEN_NOT_APPROVED", /test-account access/],
        ["DEVELOPER_TOKEN_INVALID", /rejected the developer token/],
        ["USER_PERMISSION_DENIED", /Read-only access/],
    ] as const) {
        const payload = { error: { message: config.private_key, details: [{ errors: [{ errorCode: { authorizationError: code } }] }] } }
        await assert.rejects(verifyGoogleAdsManager(config, googleResponses(manager, { status: 403, payload }).fetcher), (error: Error) => {
            assert.match(error.message, message)
            assert.doesNotMatch(error.message, /PRIVATE KEY/)
            return true
        })
    }
    await assert.rejects(verifyGoogleAdsManager(config, async () => Response.json({ error: config.private_key }, { status: 400 })), /could not authorize/)
    await assert.rejects(verifyGoogleAdsManager(config, async () => { throw new Error(config.private_key) }), /could not be reached/)
})

test("form accepts only service account keys and never follows uploaded token URLs", async () => {
    const form = new FormData()
    form.set("manager_customer_id", config.manager_customer_id)
    form.set("developer_token", config.developer_token)
    form.set("service_account_key", new File([JSON.stringify({ type: "service_account", ...config, token_uri: "https://untrusted.invalid/token" })], "key.json"))
    const parsed = await googleAdsConfigFromForm(form)
    assert.deepEqual(Object.keys(parsed).sort(), ["client_email", "developer_token", "manager_customer_id", "private_key"])
    assert.equal(parsed.manager_customer_id, "1234567890")
    form.set("service_account_key", new File(['{"type":"authorized_user"}'], "key.json"))
    await assert.rejects(googleAdsConfigFromForm(form), /not a Google Cloud service-account/)
    form.set("service_account_key", new File(["x".repeat(16_385)], "key.json"))
    await assert.rejects(googleAdsConfigFromForm(form), /up to 16 KB/)
    form.delete("service_account_key")
    await assert.rejects(googleAdsConfigFromForm(form), /Choose a Google Cloud/)
    assert.throws(() => normalizeGoogleAdsConfig({ ...config, manager_customer_id: "123/../../" }), /10-digit/)
    assert.throws(() => normalizeGoogleAdsConfig({ ...config, private_key: "bad key" }), /private key is invalid/)
})

test("Google template installation and activation preserve account and credential boundaries", () => {
    const migration = readFileSync("supabase/migrations/20260906230000_google_ads_manager_connection.sql", "utf8")
    assert.match(migration, /p_template_id = 'google-ads' and p_connection_provider = 'google_ads'/)
    assert.match(migration, /on conflict \(workspace_id, provider\) do nothing/)
    assert.match(migration, /v_candidate is distinct from p_expected_candidate/)
    assert.match(migration, /for update;/)
    assert.match(migration, /create unique index[\s\S]*where provider = 'google_ads' and enabled/)
    assert.match(migration, /revoke all on function public.activate_google_ads_manager_candidate[\s\S]*from public, anon, authenticated/)
    const actions = readFileSync("app/[workspaceSlug]/settings/actions.ts", "utf8")
    assert.match(actions, /requireWorkspace\(slug, "owner"\)[\s\S]*if \(provider === "google_ads"\)/)
    assert.match(actions, /Create a service using the Google Ads template/)
})
