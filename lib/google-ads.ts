import { createPrivateKey, sign } from "node:crypto"

const TOKEN_URL = "https://oauth2.googleapis.com/token"
const ADS_SCOPE = "https://www.googleapis.com/auth/adwords"
const API_VERSION = "v25"

export type GoogleAdsConfig = {
    manager_customer_id: string
    developer_token: string
    client_email: string
    private_key: string
}

export function normalizeGoogleAdsConfig(config: Record<string, string>): GoogleAdsConfig {
    const managerId = (config.manager_customer_id ?? "").replace(/[-\s]/g, "")
    if (!/^\d{10}$/.test(managerId)) throw new Error("Enter the 10-digit Google Ads manager account ID.")
    const developerToken = config.developer_token?.trim() ?? ""
    if (!/^[A-Za-z0-9_-]{22}$/.test(developerToken)) throw new Error("Enter the developer token from your Google Ads manager account’s API Center.")
    const email = config.client_email?.trim() ?? ""
    if (!/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(email)) throw new Error("Upload a Google Cloud service-account JSON key.")
    const privateKey = config.private_key?.trim() ?? ""
    try {
        if (createPrivateKey(privateKey).asymmetricKeyType !== "rsa") throw new Error("Invalid key")
    } catch {
        throw new Error("The service-account private key is invalid. Download a new JSON key from Google Cloud.")
    }
    return { manager_customer_id: managerId, developer_token: developerToken, client_email: email, private_key: privateKey }
}

export async function googleAdsConfigFromForm(formData: FormData): Promise<GoogleAdsConfig> {
    const file = formData.get("service_account_key")
    if (!(file instanceof File) || file.size === 0 || file.size > 16_384) throw new Error("Choose a Google Cloud service-account JSON key file (up to 16 KB).")
    let key: Record<string, unknown>
    try {
        key = JSON.parse(await file.text())
        if (!key || key.type !== "service_account") throw new Error("Wrong key type")
    } catch {
        throw new Error("This is not a Google Cloud service-account JSON key file.")
    }
    return normalizeGoogleAdsConfig({
        manager_customer_id: String(formData.get("manager_customer_id") ?? ""),
        developer_token: String(formData.get("developer_token") ?? ""),
        client_email: typeof key.client_email === "string" ? key.client_email : "",
        private_key: typeof key.private_key === "string" ? key.private_key : "",
    })
}

async function googleRequest(url: string, init: RequestInit, fetcher: typeof fetch) {
    try {
        return await fetcher(url, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) })
    } catch {
        throw new Error("Google could not be reached. Try verification again.")
    }
}

function adsError(payload: unknown, status: number): string {
    const error = (payload as { error?: { details?: Array<{ errors?: Array<{ errorCode?: Record<string, string> }>; reason?: string }> } })?.error
    const codes = error?.details?.flatMap((detail) => [detail.reason, ...(detail.errors?.flatMap((item) => Object.values(item.errorCode ?? {})) ?? [])]) ?? []
    if (codes.includes("DEVELOPER_TOKEN_NOT_APPROVED")) return "This developer token only has test-account access. Use a token with Explorer, Basic, or Standard Access."
    if (codes.includes("DEVELOPER_TOKEN_INVALID")) return "Google rejected the developer token. Copy it again from the manager account’s API Center."
    if (codes.includes("SERVICE_DISABLED")) return "Enable the Google Ads API in the service account’s Google Cloud project, then retry."
    if (codes.includes("USER_PERMISSION_DENIED")) return "Grant the service-account email Read-only access in Google Ads → Admin → Access and security for this manager account."
    if (codes.includes("CUSTOMER_NOT_ENABLED")) return "This Google Ads account is not enabled. Check its status in Google Ads."
    if (status === 429) return "Google’s API limit was reached. Wait before trying verification again."
    if (status === 401) return "Google rejected the service-account authorization. Check that the key is still active."
    if (status === 403) return "Google denied API access. Check the developer token, enable the Google Ads API, and grant the service-account email access to this manager."
    return `Google Ads verification failed (${status}). Check the manager account ID and Google API configuration, then retry.`
}

export async function verifyGoogleAdsManager(input: Record<string, string>, fetcher: typeof fetch = fetch) {
    const config = normalizeGoogleAdsConfig(input)
    const now = Math.floor(Date.now() / 1000)
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url")
    const claims = Buffer.from(JSON.stringify({ iss: config.client_email, scope: ADS_SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 })).toString("base64url")
    const unsigned = `${header}.${claims}`
    const assertion = `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), config.private_key).toString("base64url")}`
    const authorization = await googleRequest(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    }, fetcher)
    const token = await authorization.json().catch(() => null) as { access_token?: string } | null
    if (!authorization.ok || !token?.access_token) throw new Error("Google could not authorize this service-account key. Check that the account and key are still active in Google Cloud.")

    const response = await googleRequest(`https://googleads.googleapis.com/${API_VERSION}/customers/${config.manager_customer_id}/googleAds:search`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token.access_token}`, "developer-token": config.developer_token, "login-customer-id": config.manager_customer_id, "Content-Type": "application/json" },
        body: JSON.stringify({ query: "SELECT customer.id, customer.descriptive_name, customer.manager, customer.test_account, customer.currency_code, customer.time_zone FROM customer LIMIT 1" }),
    }, fetcher)
    const payload = await response.json().catch(() => null)
    if (!response.ok) throw new Error(adsError(payload, response.status))
    const customer = payload?.results?.[0]?.customer as { id?: string; descriptiveName?: string; manager?: boolean; testAccount?: boolean; currencyCode?: string; timeZone?: string } | undefined
    if (!customer || String(customer.id) !== config.manager_customer_id) throw new Error("Google did not return the requested manager account. Check its ID and access permissions.")
    if (!customer.manager) throw new Error("This is an advertising account, not a manager account. Enter the agency’s Google Ads manager account ID.")
    if (customer.testAccount) throw new Error("This is a Google Ads test manager. Connect the agency’s production manager account.")
    return {
        account_id: config.manager_customer_id,
        manager_customer_id: config.manager_customer_id,
        manager_name: customer.descriptiveName || "Google Ads manager",
        service_account_email: config.client_email,
        currency: customer.currencyCode || null,
        time_zone: customer.timeZone || null,
        verified_at: new Date().toISOString(),
        capabilities: { manager_access: true, production_api_access: true },
    }
}
