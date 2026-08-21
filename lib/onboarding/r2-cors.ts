import { getRequiredEnv } from "@/lib/env"

type CorsRule = {
    id?: string
    allowed?: { origins?: string[]; methods?: string[]; headers?: string[] }
    exposeHeaders?: string[]
    maxAgeSeconds?: number
}

const DIRECT_UPLOAD_HEADERS = [
    "content-type",
    "x-amz-server-side-encryption-customer-algorithm",
    "x-amz-server-side-encryption-customer-key",
    "x-amz-server-side-encryption-customer-key-md5",
]

async function cloudflareError(response: Response, fallback: string) {
    try {
        const body = await response.json() as { errors?: Array<{ message?: string }> }
        const detail = body.errors?.map((error) => error.message).filter(Boolean).join(" ")
        return detail ? `${fallback}: ${detail}` : fallback
    } catch {
        return fallback
    }
}

async function getCorsPolicy() {
    // The bucket is addressed through R2's account ID. Do not use the generic
    // Cloudflare account variable here: it is easy to accidentally populate it
    // with an API-token identifier (for example, one beginning with "cfat_").
    const accountId = getRequiredEnv("R2_ACCOUNT_ID")
    const token = getRequiredEnv("CLOUDFLARE_API_TOKEN")
    const bucket = getRequiredEnv("R2_BUCKET_NAME")
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${encodeURIComponent(bucket)}/cors`
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    const current = await fetch(endpoint, { headers, cache: "no-store" })
    const body = await current.json() as { result?: { rules?: CorsRule[] }; errors?: Array<{ message?: string }> }
    const missingPolicy = !current.ok && body.errors?.some((error) => error.message?.toLowerCase().includes("cors configuration does not exist"))
    if (!current.ok && !missingPolicy) {
        const detail = body.errors?.map((error) => error.message).filter(Boolean).join(" ")
        throw new Error(detail ? `Could not read the R2 upload CORS policy: ${detail}` : "Could not read the R2 upload CORS policy")
    }
    return { endpoint, headers, rules: body.result?.rules ?? [] }
}

async function saveCorsPolicy(endpoint: string, headers: Record<string, string>, rules: CorsRule[]) {
    const saved = await fetch(endpoint, { method: "PUT", headers, body: JSON.stringify({ rules }), cache: "no-store" })
    if (!saved.ok) throw new Error(await cloudflareError(saved, "Could not update the R2 upload CORS policy"))
}

function platformUploadRule(): CorsRule {
    const origins = new Set([
        "https://betelgeze.com",
        "https://www.betelgeze.com",
        "https://app.betelgeze.com",
        "https://dashboard.betelgeze.com",
        "https://onboarding.betelgeze.com",
    ])
    if (process.env.NEXT_PUBLIC_SITE_URL) {
        origins.add(new URL(process.env.NEXT_PUBLIC_SITE_URL).origin)
    }
    return {
        id: "betelgeze-onboarding-platform",
        allowed: { origins: [...origins], methods: ["PUT"], headers: DIRECT_UPLOAD_HEADERS },
        exposeHeaders: ["ETag"],
        maxAgeSeconds: 3600,
    }
}

let platformUploadRuleUpdatedAt = 0

export async function ensurePlatformDirectUploads() {
    // Direct browser uploads need the app host in the bucket CORS policy. Keep
    // this opportunistic so local environments without Cloudflare credentials
    // can still issue and use their own signed URLs.
    if (!process.env.CLOUDFLARE_API_TOKEN) return
    if (Date.now() - platformUploadRuleUpdatedAt < 60 * 60 * 1000) return
    const { endpoint, headers, rules } = await getCorsPolicy()
    await saveCorsPolicy(endpoint, headers, withPlatformUploadRule(rules))
    platformUploadRuleUpdatedAt = Date.now()
}

function withPlatformUploadRule(rules: CorsRule[]) {
    return [...rules.filter((rule) => rule.id !== "betelgeze-onboarding-platform"), platformUploadRule()]
}

export async function allowDirectUploadsFromDomain(domain: string) {
    const { endpoint, headers, rules: existingRules } = await getCorsPolicy()
    const id = `betelgeze-onboarding-${domain}`
    const rules = existingRules.filter((rule) => rule.id !== id)
    rules.push({
        id,
        allowed: { origins: [`https://${domain}`], methods: ["PUT"], headers: DIRECT_UPLOAD_HEADERS },
        exposeHeaders: ["ETag"],
        maxAgeSeconds: 3600,
    })
    await saveCorsPolicy(endpoint, headers, withPlatformUploadRule(rules))
}

export async function removeDirectUploadsFromDomain(domain: string) {
    const { endpoint, headers, rules: existingRules } = await getCorsPolicy()
    const rules = existingRules.filter((rule) => rule.id !== `betelgeze-onboarding-${domain}`)
    await saveCorsPolicy(endpoint, headers, withPlatformUploadRule(rules))
}
