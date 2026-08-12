import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto"
import { getRequiredEnv } from "@/lib/env"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { stripeAccountMode } from "@/lib/stripe/mode"

export const INTEGRATION_PROVIDERS = ["stripe", "meta_whatsapp"] as const
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number]
export type IntegrationConfig = Record<string, string>
export type ConnectionAuthMethod = "legacy" | "oauth" | "embedded_signup" | "manual"
export type ConnectionStatus = "not_connected" | "connecting" | "connected" | "needs_attention" | "degraded"

export type WorkspaceConnection = {
    provider: IntegrationProvider
    enabled: boolean
    mode: string
    config_hint: Record<string, unknown>
    connection_status?: ConnectionStatus
    auth_method?: ConnectionAuthMethod | null
    capabilities?: Record<string, unknown>
    last_verified_at?: string | null
    last_webhook_at?: string | null
    last_error?: string | null
    candidate_config_hint?: Record<string, unknown>
    candidate_auth_method?: ConnectionAuthMethod | null
    previous_mode?: string | null
}

const META_GRAPH_VERSION = "v25.0"

function forceSavedLegacy(mode: string | null | undefined) {
    return process.env.WORKSPACE_CONNECTIONS_FORCE_LEGACY === "true" && mode === "platform_legacy"
}

function encryptionKey() {
    const key = Buffer.from(getRequiredEnv("WORKSPACE_INTEGRATION_ENCRYPTION_KEY"), "base64")
    if (key.length !== 32) throw new Error("WORKSPACE_INTEGRATION_ENCRYPTION_KEY must be a base64-encoded 32-byte key.")
    return key
}

function encrypt(config: IntegrationConfig) {
    const iv = randomBytes(12)
    const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv)
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(config), "utf8"), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64")
}

export function decryptWorkspaceIntegration(value: string): IntegrationConfig {
    const payload = Buffer.from(value, "base64")
    const iv = payload.subarray(0, 12)
    const tag = payload.subarray(12, 28)
    const encrypted = payload.subarray(28)
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv)
    decipher.setAuthTag(tag)
    return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")) as IntegrationConfig
}

function cleanConfig(config: IntegrationConfig) {
    return Object.fromEntries(Object.entries(config).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value.length > 0))
}

export function integrationHint(provider: IntegrationProvider, config: IntegrationConfig): Record<string, string | null> {
    if (provider === "stripe") return {
        key_suffix: (config.access_token || config.secret_key)?.slice(-4) ?? null,
        currency: config.default_currency || "usd",
        account_id: config.account_id || null,
        mode: config.livemode === "true" ? "live" : config.livemode === "false" ? "test" : null,
    }
    return {
        phone_number_id: config.phone_number_id || null,
        waba_id: config.waba_id || null,
        template: config.consent_template_name || null,
    }
}

function isMissingUniversalConnectionSchema(error: { code?: string; message?: string } | null | undefined) {
    const message = error?.message?.toLowerCase() ?? ""
    return error?.code === "42703" || error?.code === "PGRST204" || message.includes("candidate_config") || message.includes("connection_status")
}

export async function listWorkspaceConnections(workspaceId: string): Promise<WorkspaceConnection[]> {
    const universal = await supabaseAdmin
        .from("workspace_integrations")
        .select("provider, enabled, mode, config_hint, connection_status, auth_method, capabilities, last_verified_at, last_webhook_at, last_error, candidate_config_hint, candidate_auth_method, previous_mode")
        .eq("workspace_id", workspaceId)
    if (!universal.error) return (universal.data ?? []) as WorkspaceConnection[]
    if (!isMissingUniversalConnectionSchema(universal.error)) throw new Error(`Could not load workspace connections: ${universal.error.message}`)

    const legacy = await supabaseAdmin
        .from("workspace_integrations")
        .select("provider, enabled, mode, config_hint")
        .eq("workspace_id", workspaceId)
    if (legacy.error) throw new Error(`Could not load workspace connections: ${legacy.error.message}`)
    return (legacy.data ?? []).map((item) => ({
        ...(item as WorkspaceConnection),
        connection_status: item.enabled ? (item.mode === "platform_legacy" || Boolean((item.config_hint as Record<string, unknown>)?.verified_at) ? "connected" : "needs_attention") : "not_connected",
        auth_method: item.mode === "platform_legacy" ? "legacy" : item.mode === "connected" ? "manual" : null,
    }))
}

export async function saveWorkspaceIntegration(workspaceId: string, provider: IntegrationProvider, config: IntegrationConfig, userId: string) {
    const cleaned = cleanConfig(config)
    const { error } = await supabaseAdmin.from("workspace_integrations").upsert({
        workspace_id: workspaceId,
        provider,
        enabled: true,
        mode: "connected",
        config_encrypted: encrypt(cleaned),
        config_hint: integrationHint(provider, cleaned),
        configured_at: new Date().toISOString(),
        configured_by: userId,
        connected_account_id: "manual",
    })
    if (error) throw new Error("Could not save this connection.")
}

export async function stageWorkspaceIntegrationCandidate(input: {
    workspaceId: string
    provider: IntegrationProvider
    config: IntegrationConfig
    authMethod: Exclude<ConnectionAuthMethod, "legacy">
    userId: string
}) {
    const cleaned = cleanConfig(input.config)
    const now = new Date().toISOString()
    const { error } = await supabaseAdmin.from("workspace_integrations").upsert({
        workspace_id: input.workspaceId,
        provider: input.provider,
        candidate_config_encrypted: encrypt(cleaned),
        candidate_config_hint: integrationHint(input.provider, cleaned),
        candidate_auth_method: input.authMethod,
        candidate_configured_at: now,
        candidate_configured_by: input.userId,
        connection_status: "connecting",
        last_error: null,
    }, { onConflict: "workspace_id,provider" })
    if (error) {
        if (isMissingUniversalConnectionSchema(error)) throw new Error("Apply the universal workspace connections migration before using the new connection procedure.")
        throw new Error(`Could not stage this connection: ${error.message}`)
    }
}

async function candidateConfig(workspaceId: string, provider: IntegrationProvider) {
    const { data, error } = await supabaseAdmin
        .from("workspace_integrations")
        .select("candidate_config_encrypted, candidate_auth_method")
        .eq("workspace_id", workspaceId)
        .eq("provider", provider)
        .maybeSingle()
    if (error || !data?.candidate_config_encrypted) throw new Error(error?.message ?? "No connection is waiting to be verified.")
    return {
        config: decryptWorkspaceIntegration(data.candidate_config_encrypted),
        authMethod: data.candidate_auth_method as Exclude<ConnectionAuthMethod, "legacy">,
    }
}

async function stripeAccount(config: IntegrationConfig) {
    const token = config.access_token || config.secret_key
    if (!token) throw new Error("Stripe did not provide an access token.")
    const response = await fetch("https://api.stripe.com/v1/account", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
    const body = await response.text()
    if (!response.ok) throw new Error(`Stripe rejected this connection (${response.status}). Reconnect the account and try again.`)
    return JSON.parse(body) as { id?: string; livemode?: boolean; business_profile?: { name?: string }; settings?: { dashboard?: { display_name?: string } } }
}

async function metaGet(path: string, accessToken: string) {
    const response = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${path}`, {
        headers: { Authorization: `Bearer ${accessToken}`, accept: "application/json" },
        cache: "no-store",
    })
    const body = await response.text()
    if (!response.ok) throw new Error(`Meta rejected this connection (${response.status}). Reconnect WhatsApp and try again.`)
    return body ? JSON.parse(body) as Record<string, unknown> : {}
}

async function verifyStripeCandidate(config: IntegrationConfig) {
    const account = await stripeAccount(config)
    if (!account.id) throw new Error("Stripe verified the token but did not return an account ID.")
    const mode = stripeAccountMode({
        credential: config.secret_key || config.access_token,
        configuredLivemode: config.livemode,
        accountLivemode: account.livemode,
    })
    return {
        ...integrationHint("stripe", { ...config, account_id: account.id, livemode: String(mode === "live") }),
        account_id: account.id,
        account_name: account.business_profile?.name ?? account.settings?.dashboard?.display_name ?? null,
        mode,
        verified_at: new Date().toISOString(),
        capabilities: {
            account_access: true,
            invoice_access: true,
            webhook_routing: Boolean(
                config.webhook_secret ||
                process.env.STRIPE_APP_TEST_WEBHOOK_SECRET ||
                process.env.STRIPE_APP_LIVE_WEBHOOK_SECRET ||
                process.env.STRIPE_APP_WEBHOOK_SECRET
            ),
        },
    }
}

async function verifyWhatsAppCandidate(config: IntegrationConfig) {
    if (!config.access_token || !config.phone_number_id) throw new Error("WhatsApp did not provide an access token and phone number ID.")
    const phone = await metaGet(`${encodeURIComponent(config.phone_number_id)}?fields=id,display_phone_number,verified_name`, config.access_token)
    const wabaId = config.waba_id
    const subscriptions = wabaId ? await metaGet(`${encodeURIComponent(wabaId)}/subscribed_apps`, config.access_token) : null
    const subscribed = Array.isArray(subscriptions?.data) && subscriptions.data.length > 0
    let templateApproved = false
    if (wabaId && config.consent_template_name) {
        const templates = await metaGet(`${encodeURIComponent(wabaId)}/message_templates?name=${encodeURIComponent(config.consent_template_name)}&fields=name,status,language`, config.access_token)
        templateApproved = Array.isArray(templates.data) && templates.data.some((item) => {
            if (!item || typeof item !== "object") return false
            const record = item as { name?: unknown; status?: unknown; language?: unknown }
            return record.name === config.consent_template_name && record.status === "APPROVED" && (!config.consent_template_language || record.language === config.consent_template_language)
        })
    }
    if (!subscribed) throw new Error("WhatsApp is connected, but Betelgeze is not subscribed to this business account's webhooks.")
    if (!templateApproved) throw new Error(`WhatsApp is connected, but the ${config.consent_template_name || "confirmation"} template is not approved for the selected language.`)
    return {
        ...integrationHint("meta_whatsapp", config),
        display_phone_number: typeof phone.display_phone_number === "string" ? phone.display_phone_number : null,
        verified_name: typeof phone.verified_name === "string" ? phone.verified_name : null,
        verified_at: new Date().toISOString(),
        capabilities: { phone_access: true, outbound_messages: true, webhook_subscribed: true, consent_template_approved: true },
    }
}

export async function verifyAndActivateWorkspaceIntegrationCandidate(workspaceId: string, provider: IntegrationProvider) {
    const candidate = await candidateConfig(workspaceId, provider)
    try {
        const hint = provider === "stripe" ? await verifyStripeCandidate(candidate.config) : await verifyWhatsAppCandidate(candidate.config)
        const externalAccountId = provider === "stripe"
            ? (hint as Record<string, unknown>).account_id
            : (hint as Record<string, unknown>).waba_id
        if (typeof externalAccountId === "string" && externalAccountId) {
            const { data: alreadyConnected, error: connectedLookupError } = await supabaseAdmin.from("workspace_integrations")
                .select("workspace_id")
                .eq("provider", provider)
                .eq("enabled", true)
                .eq("mode", "connected")
                .eq("connected_account_id", externalAccountId)
                .neq("workspace_id", workspaceId)
                .limit(1)
                .maybeSingle()
            if (connectedLookupError) throw new Error(`Betelgeze could not confirm that this provider account is unique: ${connectedLookupError.message}`)
            if (alreadyConnected) throw new Error(`This ${provider === "stripe" ? "Stripe" : "WhatsApp"} account is already connected to another Betelgeze workspace.`)
        }
        const hintUpdate = await supabaseAdmin.from("workspace_integrations").update({ candidate_config_hint: hint }).eq("workspace_id", workspaceId).eq("provider", provider)
        if (hintUpdate.error) throw new Error(hintUpdate.error.message)
        const activation = await supabaseAdmin.rpc("activate_workspace_integration_candidate", { p_workspace_id: workspaceId, p_provider: provider })
        if (activation.error) throw new Error(activation.error.message)
        return hint
    } catch (error) {
        const message = error instanceof Error ? error.message : "Connection verification failed."
        await supabaseAdmin.from("workspace_integrations").update({ connection_status: "needs_attention", last_error: message }).eq("workspace_id", workspaceId).eq("provider", provider)
        throw error
    }
}

export async function discardWorkspaceIntegrationCandidate(workspaceId: string, provider: IntegrationProvider) {
    const { data: current } = await supabaseAdmin.from("workspace_integrations").select("enabled, mode").eq("workspace_id", workspaceId).eq("provider", provider).maybeSingle()
    const { error } = await supabaseAdmin.from("workspace_integrations").update({
        candidate_config_encrypted: null,
        candidate_config_hint: {},
        candidate_auth_method: null,
        candidate_configured_at: null,
        candidate_configured_by: null,
        connection_status: current?.enabled ? "connected" : "not_connected",
        last_error: null,
    }).eq("workspace_id", workspaceId).eq("provider", provider)
    if (error) throw new Error(`Could not discard the pending connection: ${error.message}`)
}

export async function restorePreviousWorkspaceIntegration(workspaceId: string, provider: IntegrationProvider) {
    const { error } = await supabaseAdmin.rpc("restore_workspace_integration_previous", { p_workspace_id: workspaceId, p_provider: provider })
    if (error) throw new Error(`Could not restore the previous connection: ${error.message}`)
}

export async function disconnectWorkspaceIntegration(workspaceId: string, provider: IntegrationProvider) {
    const { error } = await supabaseAdmin.from("workspace_integrations").update({
        enabled: false,
        mode: "disabled",
        connection_status: "not_connected",
        auth_method: null,
        config_encrypted: null,
        config_hint: {},
        capabilities: {},
        connected_account_id: null,
        last_verified_at: null,
        last_error: null,
    }).eq("workspace_id", workspaceId).eq("provider", provider)
    if (error) throw new Error(`Could not disconnect this provider: ${error.message}`)
}

export async function createConnectionAttempt(input: { workspaceId: string; provider: IntegrationProvider; authMethod: "oauth"; userId: string; metadata?: Record<string, unknown> }) {
    const state = randomBytes(32).toString("base64url")
    const stateHash = createHash("sha256").update(state).digest("hex")
    const { error } = await supabaseAdmin.from("workspace_connection_attempts").insert({
        workspace_id: input.workspaceId,
        provider: input.provider,
        auth_method: input.authMethod,
        state_hash: stateHash,
        requested_by: input.userId,
        metadata: input.metadata ?? {},
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    })
    if (error) {
        if (isMissingUniversalConnectionSchema(error)) throw new Error("Apply the universal workspace connections migration before using OAuth.")
        throw new Error(`Could not start the connection: ${error.message}`)
    }
    return state
}

export async function consumeConnectionAttempt(state: string, provider: IntegrationProvider) {
    const stateHash = createHash("sha256").update(state).digest("hex")
    const { data, error } = await supabaseAdmin.from("workspace_connection_attempts")
        .select("id, workspace_id, requested_by, metadata, expires_at, status")
        .eq("state_hash", stateHash).eq("provider", provider).maybeSingle()
    if (error || !data || data.status !== "pending" || new Date(data.expires_at).getTime() <= Date.now()) throw new Error("This connection attempt expired or has already been used. Start again from Settings.")
    return data as { id: string; workspace_id: string; requested_by: string; metadata: Record<string, unknown>; expires_at: string; status: string }
}

export async function finishConnectionAttempt(id: string, error?: string) {
    await supabaseAdmin.from("workspace_connection_attempts").update({ status: error ? "failed" : "completed", error: error ?? null, completed_at: new Date().toISOString() }).eq("id", id).eq("status", "pending")
}

export async function verifyWorkspaceIntegration(workspaceId: string, provider: IntegrationProvider) {
    const config = await getWorkspaceProviderConfig(workspaceId, provider)
    const hint = provider === "stripe" ? await verifyStripeCandidate(config) : await verifyWhatsAppCandidate(config)
    const { error } = await supabaseAdmin.from("workspace_integrations").update({ config_hint: hint, capabilities: hint.capabilities, connection_status: "connected", last_verified_at: new Date().toISOString(), last_error: null }).eq("workspace_id", workspaceId).eq("provider", provider).eq("mode", "connected")
    if (error) throw new Error("Could not record the successful connection check.")
}

export async function requireLegacyProviderAccess(workspaceId: string, provider: IntegrationProvider) {
    const { data } = await supabaseAdmin.from("workspace_integrations").select("enabled, mode").eq("workspace_id", workspaceId).eq("provider", provider).maybeSingle()
    if (data?.enabled && data.mode === "platform_legacy") return
    throw new Error(`${provider} is not connected for this workspace yet.`)
}

function legacyConfig(provider: IntegrationProvider): IntegrationConfig {
    if (provider === "stripe") return {
        secret_key: getRequiredEnv("STRIPE_SECRET_KEY"),
        webhook_secret: getRequiredEnv("STRIPE_WEBHOOK_SECRET"),
        default_currency: process.env.STRIPE_DEFAULT_CURRENCY ?? "usd",
    }
    return {
        access_token: getRequiredEnv("META_WHATSAPP_ACCESS_TOKEN"),
        phone_number_id: getRequiredEnv("META_WHATSAPP_PHONE_NUMBER_ID"),
        webhook_verify_token: getRequiredEnv("META_WHATSAPP_WEBHOOK_VERIFY_TOKEN"),
        consent_template_name: process.env.META_WHATSAPP_CONSENT_TEMPLATE_NAME ?? process.env.META_WHATSAPP_ONBOARDING_TEMPLATE_NAME ?? "",
        consent_template_language: process.env.META_WHATSAPP_CONSENT_TEMPLATE_LANGUAGE ?? process.env.META_WHATSAPP_ONBOARDING_TEMPLATE_LANGUAGE ?? "en_US",
    }
}

async function refreshStripeOAuth(workspaceId: string, config: IntegrationConfig): Promise<IntegrationConfig> {
    const expiresAt = Number(config.access_token_expires_at || 0)
    if (!config.refresh_token || !expiresAt || expiresAt > Date.now() + 5 * 60_000) return config
    const developerKey = config.livemode === "true" ? getRequiredEnv("STRIPE_APP_LIVE_SECRET_KEY") : getRequiredEnv("STRIPE_APP_TEST_SECRET_KEY")
    const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: config.refresh_token })
    const response = await fetch("https://api.stripe.com/v1/oauth/token", { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${developerKey}:`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body })
    const payload = await response.json() as { access_token?: string; refresh_token?: string; account_id?: string }
    if (!response.ok || !payload.access_token || !payload.refresh_token) throw new Error("Stripe authorization expired and could not be refreshed. Reconnect Stripe in Settings.")
    const refreshed = { ...config, access_token: payload.access_token, refresh_token: payload.refresh_token, account_id: payload.account_id ?? config.account_id, access_token_expires_at: String(Date.now() + 60 * 60_000) }
    const { error } = await supabaseAdmin.from("workspace_integrations").update({ config_encrypted: encrypt(refreshed), last_error: null }).eq("workspace_id", workspaceId).eq("provider", "stripe").eq("mode", "connected")
    if (error) throw new Error("Stripe refreshed its authorization, but Betelgeze could not store the new token.")
    return refreshed
}

export async function getWorkspaceProviderConfig(workspaceId: string, provider: IntegrationProvider): Promise<IntegrationConfig> {
    const universal = await supabaseAdmin.from("workspace_integrations").select("enabled, mode, auth_method, config_encrypted, previous_mode").eq("workspace_id", workspaceId).eq("provider", provider).maybeSingle()
    const fallback = universal.error && isMissingUniversalConnectionSchema(universal.error)
        ? await supabaseAdmin.from("workspace_integrations").select("enabled, mode, config_encrypted").eq("workspace_id", workspaceId).eq("provider", provider).maybeSingle()
        : null
    if (universal.error && !fallback) throw new Error(`Could not load the ${provider} connection: ${universal.error.message}`)
    if (fallback?.error) throw new Error(`Could not load the ${provider} connection: ${fallback.error.message}`)
    const data = universal.data ?? (fallback?.data ? { ...fallback.data, auth_method: fallback.data.mode === "connected" ? "manual" : fallback.data.mode === "platform_legacy" ? "legacy" : null } : null)
    if (!data?.enabled) throw new Error(`${provider} is not connected for this workspace.`)
    if (forceSavedLegacy("previous_mode" in data ? data.previous_mode : null)) return legacyConfig(provider)
    if (data.mode === "connected" && data.config_encrypted) {
        const config = decryptWorkspaceIntegration(data.config_encrypted)
        return provider === "stripe" && data.auth_method === "oauth" ? refreshStripeOAuth(workspaceId, config) : config
    }
    if (data.mode === "platform_legacy") return legacyConfig(provider)
    throw new Error(`${provider} is not connected for this workspace.`)
}

export async function getWorkspaceIdForConnectedAccount(provider: IntegrationProvider, externalAccountId: string) {
    const { data } = await supabaseAdmin.from("workspace_integrations").select("workspace_id").eq("provider", provider).eq("enabled", true).eq("connected_account_id", externalAccountId).maybeSingle()
    return data?.workspace_id ?? null
}

export async function getWorkspaceIdForWhatsAppPhoneNumber(phoneNumberId: string) {
    const { data } = await supabaseAdmin.from("workspace_integrations").select("workspace_id, mode, previous_mode, config_hint").eq("provider", "meta_whatsapp").eq("enabled", true)
    const match = (data ?? []).find((item) => {
        if (item.mode === "platform_legacy" || forceSavedLegacy(item.previous_mode)) return process.env.META_WHATSAPP_PHONE_NUMBER_ID === phoneNumberId
        return item.mode === "connected" && (item.config_hint as Record<string, unknown>)?.phone_number_id === phoneNumberId
    })
    return match?.workspace_id ?? null
}

export async function recordWorkspaceConnectionWebhook(workspaceId: string, provider: IntegrationProvider) {
    await supabaseAdmin.from("workspace_integrations").update({ last_webhook_at: new Date().toISOString() }).eq("workspace_id", workspaceId).eq("provider", provider)
}

export async function getStripeWebhookCandidates() {
    type StripeWebhookCandidate = {
        workspaceId: string | null
        webhookSecret: string
        shared: boolean
        livemode: boolean | null
    }
    const { data } = await supabaseAdmin.from("workspace_integrations").select("workspace_id, mode, previous_mode, auth_method, enabled, config_encrypted").eq("provider", "stripe").eq("enabled", true)
    const candidates: StripeWebhookCandidate[] = (data ?? []).flatMap((item): StripeWebhookCandidate[] => {
        try {
            if (item.mode === "platform_legacy" || forceSavedLegacy(item.previous_mode)) return [{ workspaceId: item.workspace_id as string | null, webhookSecret: getRequiredEnv("STRIPE_WEBHOOK_SECRET"), shared: false, livemode: null }]
            if (item.mode === "connected" && item.config_encrypted && item.auth_method !== "oauth") {
                const config = decryptWorkspaceIntegration(item.config_encrypted)
                return config.webhook_secret ? [{ workspaceId: item.workspace_id as string | null, webhookSecret: config.webhook_secret, shared: false, livemode: null }] : []
            }
        } catch { return [] }
        return []
    })
    if (process.env.STRIPE_APP_TEST_WEBHOOK_SECRET) candidates.push({ workspaceId: null, webhookSecret: process.env.STRIPE_APP_TEST_WEBHOOK_SECRET, shared: true, livemode: false })
    if (process.env.STRIPE_APP_LIVE_WEBHOOK_SECRET) candidates.push({ workspaceId: null, webhookSecret: process.env.STRIPE_APP_LIVE_WEBHOOK_SECRET, shared: true, livemode: true })
    // Compatibility fallback for the first universal-connections release.
    if (process.env.STRIPE_APP_WEBHOOK_SECRET) candidates.push({ workspaceId: null, webhookSecret: process.env.STRIPE_APP_WEBHOOK_SECRET, shared: true, livemode: null })
    return candidates.filter((candidate, index, all) => all.findIndex((other) =>
        other.workspaceId === candidate.workspaceId &&
        other.webhookSecret === candidate.webhookSecret &&
        other.livemode === candidate.livemode
    ) === index)
}
