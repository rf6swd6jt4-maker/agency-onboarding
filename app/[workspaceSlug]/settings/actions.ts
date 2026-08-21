"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { requireWorkspace } from "@/lib/workspaces"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { storeWorkspaceImage } from "@/lib/onboarding/uploads"
import {
    discardWorkspaceIntegrationCandidate,
    disconnectWorkspaceIntegration,
    INTEGRATION_PROVIDERS,
    IntegrationProvider,
    restorePreviousWorkspaceIntegration,
    saveWorkspaceIntegration,
    stageWorkspaceIntegrationCandidate,
    verifyAndActivateWorkspaceIntegrationCandidate,
    verifyWorkspaceIntegration,
} from "@/lib/workspace-integrations"
import { normalizeOnboardingDomain } from "@/lib/onboarding/custom-domain"
import { attachOnboardingDomain, removeOnboardingDomain, verifyOnboardingDomain } from "@/lib/onboarding/vercel-domains"
import { allowDirectUploadsFromDomain, removeDirectUploadsFromDomain } from "@/lib/onboarding/r2-cors"
import { recordAdminActivity } from "@/lib/admin/activity"
import { MAINTENANCE_ROUTE_KEYS, platformFailureFingerprint, reportPlatformFailure, type MaintenanceRouteKey } from "@/lib/admin/maintenance"

function refresh(slug: string) {
    revalidatePath(`/${slug}`)
    revalidatePath(`/${slug}/leadgen`)
    revalidatePath(`/${slug}/settings`)
}

async function requireWorkspaceOfficer(workspaceId: string, userId: string) {
    const { data } = await supabaseAdmin.from("workspace_memberships").select("role").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle()
    if (!data || !["owner", "admin"].includes(data.role)) throw new Error("Choose a workspace owner or admin.")
}

export async function saveWorkspaceOfficers(slug: string, formData: FormData) {
    const { workspace, user } = await requireWorkspace(slug, "admin")
    const selections = MAINTENANCE_ROUTE_KEYS.map((key) => ({ key, userId: String(formData.get(key) ?? "").trim() }))
    for (const selection of selections) {
        if (selection.userId) await requireWorkspaceOfficer(workspace.id, selection.userId)
    }
    const now = new Date().toISOString()
    for (const selection of selections) {
        const query = selection.userId
            ? supabaseAdmin.from("workspace_maintenance_routing").upsert({ workspace_id: workspace.id, category: selection.key as MaintenanceRouteKey, responsible_user_id: selection.userId, updated_by: user.id, updated_at: now })
            : supabaseAdmin.from("workspace_maintenance_routing").delete().eq("workspace_id", workspace.id).eq("category", selection.key)
        const { error } = await query
        if (error) {
            await reportPlatformFailure({
                workspaceId: workspace.id,
                category: "system_health",
                source: "settings_officers",
                operation: "save",
                fingerprint: platformFailureFingerprint(["settings", "officers", "save", selection.key, error.code]),
                severity: "warning",
                summary: "Responsible officer settings could not be saved",
                diagnostics: { route_key: selection.key, code: error.code, error: error.message },
                sourceHref: `/${workspace.slug}/settings#officers`,
            })
            redirect(`/${workspace.slug}/settings?officers=save-failed#officers`)
        }
    }
    await recordAdminActivity({ workspaceId: workspace.id, category: "maintenance", eventKey: "maintenance.officers.updated", summary: "Responsible officers were updated", sourceHref: `/${workspace.slug}/settings#officers`, actorUserId: user.id, metadata: Object.fromEntries(selections.map((selection) => [selection.key, selection.userId || null])) })
    revalidatePath(`/${slug}/settings`)
    revalidatePath(`/${slug}/admin`)
    revalidatePath(`/${slug}/admin/maintenance`)
}

async function assertWorkspaceConnectionIsEditable(workspaceId: string, provider: IntegrationProvider) {
    const { data } = await supabaseAdmin
        .from("workspace_integrations")
        .select("mode")
        .eq("workspace_id", workspaceId)
        .eq("provider", provider)
        .maybeSingle()
    if (data?.mode === "platform_legacy") {
        throw new Error("This managed platform connection cannot be changed from workspace settings.")
    }
}

export async function updateWorkspaceName(slug: string, formData: FormData) {
    const { workspace } = await requireWorkspace(slug, "admin")
    const name = String(formData.get("name") ?? "").trim()
    if (name.length < 2 || name.length > 100) throw new Error("Workspace names must be between 2 and 100 characters.")
    const { error } = await supabaseAdmin.from("workspaces").update({ name }).eq("id", workspace.id)
    if (error) throw new Error("Could not update workspace name.")
    refresh(slug)
}

export async function updateWorkspaceCoverLayout(slug: string, bannerHeight: number, bannerPosition: number) {
    const { workspace } = await requireWorkspace(slug, "admin")
    if (!Number.isInteger(bannerHeight) || bannerHeight < 192 || bannerHeight > 288) throw new Error("Banner height must be between 192px and 288px.")
    if (!Number.isInteger(bannerPosition) || bannerPosition < 0 || bannerPosition > 100) throw new Error("Banner position must be between 0 and 100.")
    const { error } = await supabaseAdmin.from("workspaces").update({ banner_height: bannerHeight, banner_position: bannerPosition }).eq("id", workspace.id)
    if (error) throw new Error("Could not update workspace cover.")
    refresh(slug)
}

export async function uploadWorkspaceBanner(slug: string, formData: FormData) {
    const { workspace } = await requireWorkspace(slug, "admin")
    const file = formData.get("banner")
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose an image to upload.")
    const bannerPath = await storeWorkspaceImage(workspace.id, { name: file.name, size: file.size, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) })
    const { error } = await supabaseAdmin.from("workspaces").update({ banner_path: bannerPath }).eq("id", workspace.id)
    if (error) throw new Error("The banner uploaded, but could not be saved to this workspace.")
    refresh(slug)
}

export async function uploadWorkspaceLogo(slug: string, formData: FormData) {
    const { workspace } = await requireWorkspace(slug, "admin")
    const file = formData.get("logo")
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose an image to upload.")
    const logoPath = await storeWorkspaceImage(workspace.id, { name: file.name, size: file.size, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) })
    const { error } = await supabaseAdmin.from("workspaces").update({ logo_path: logoPath }).eq("id", workspace.id)
    if (error) throw new Error("The logo uploaded, but could not be saved to this workspace.")
    refresh(slug)
}

export async function removeWorkspaceInvitation(slug: string, invitationId: string) {
    const { workspace } = await requireWorkspace(slug, "admin")
    const { error } = await supabaseAdmin
        .from("workspace_invitations")
        .update({ revoked_at: new Date().toISOString(), delivery_status: "revoked", token_hash: null })
        .eq("id", invitationId)
        .eq("workspace_id", workspace.id)
        .is("accepted_at", null)
    if (error) throw new Error("Could not revoke this invitation.")
    refresh(slug)
}

export async function saveWorkspaceConnection(slug: string, provider: IntegrationProvider, formData: FormData) {
    if (!INTEGRATION_PROVIDERS.includes(provider)) throw new Error("Unknown connection.")
    const { workspace, user } = await requireWorkspace(slug, "owner")
    await assertWorkspaceConnectionIsEditable(workspace.id, provider)
    const config = Object.fromEntries([...formData.entries()].filter(([, value]) => typeof value === "string")) as Record<string, string>
    const required: Record<IntegrationProvider, string[]> = {
        stripe: ["secret_key", "webhook_secret"],
        meta_whatsapp: ["access_token", "phone_number_id", "webhook_verify_token"],
        twilio_sms: ["account_sid", "auth_token", "phone_number"],
    }
    if (required[provider].some((key) => !config[key]?.trim())) throw new Error("Fill in all required connection details before saving.")
    await saveWorkspaceIntegration(workspace.id, provider, config, user.id)
    refresh(slug)
}

export async function verifyWorkspaceConnection(slug: string, provider: IntegrationProvider): Promise<WorkspaceConnectionActionResult> {
    return connectionAction(async () => {
        if (!INTEGRATION_PROVIDERS.includes(provider)) throw new Error("Unknown connection.")
        const { workspace } = await requireWorkspace(slug, "owner")
        await assertWorkspaceConnectionIsEditable(workspace.id, provider)
        await verifyWorkspaceIntegration(workspace.id, provider)
        refresh(slug)
    })
}

export type WorkspaceConnectionActionResult = { ok: true } | { ok: false; error: string }

async function connectionAction(run: () => Promise<void>): Promise<WorkspaceConnectionActionResult> {
    try {
        await run()
        return { ok: true }
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "The connection could not be updated." }
    }
}

export async function stageManualWorkspaceConnection(slug: string, provider: IntegrationProvider, formData: FormData): Promise<WorkspaceConnectionActionResult> {
    return connectionAction(async () => {
        if (!INTEGRATION_PROVIDERS.includes(provider)) throw new Error("Unknown connection.")
        const { workspace, user } = await requireWorkspace(slug, "owner")
        const config = Object.fromEntries([...formData.entries()].filter(([, value]) => typeof value === "string")) as Record<string, string>
        const required: Record<IntegrationProvider, string[]> = {
            stripe: ["secret_key", "webhook_secret"],
            meta_whatsapp: ["access_token", "phone_number_id", "waba_id", "consent_template_name"],
            twilio_sms: ["account_sid", "auth_token", "phone_number"],
        }
        if (required[provider].some((key) => !config[key]?.trim())) throw new Error("Fill in every required connection detail before continuing.")
        await stageWorkspaceIntegrationCandidate({ workspaceId: workspace.id, provider, config, authMethod: "manual", userId: user.id })
        await verifyAndActivateWorkspaceIntegrationCandidate(workspace.id, provider)
        refresh(slug)
    })
}

export async function completeWhatsAppEmbeddedSignup(slug: string, input: {
    code: string
    wabaId: string
    phoneNumberId: string
    consentTemplateName: string
    consentTemplateLanguage: string
}): Promise<WorkspaceConnectionActionResult> {
    return connectionAction(async () => {
        const { workspace, user } = await requireWorkspace(slug, "owner")
        if (!input.code || !input.wabaId || !input.phoneNumberId) throw new Error("Meta did not return the WhatsApp account and phone number. Run Embedded Signup again.")
        const appId = process.env.NEXT_PUBLIC_META_APP_ID
        const appSecret = process.env.META_APP_SECRET
        if (!appId || !appSecret || !process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID) throw new Error("Betelgeze Embedded Signup is not configured yet. Use manual connection or add the Meta app credentials in Vercel.")
        const tokenUrl = new URL("https://graph.facebook.com/v25.0/oauth/access_token")
        tokenUrl.searchParams.set("client_id", appId)
        tokenUrl.searchParams.set("client_secret", appSecret)
        tokenUrl.searchParams.set("code", input.code)
        const tokenResponse = await fetch(tokenUrl, { cache: "no-store" })
        const tokenPayload = await tokenResponse.json() as { access_token?: string; error?: { message?: string } }
        if (!tokenResponse.ok || !tokenPayload.access_token) throw new Error(tokenPayload.error?.message ?? "Meta could not finish Embedded Signup.")

        const webhookUrl = new URL("/api/client-messages/meta/whatsapp", process.env.NEXT_PUBLIC_SITE_URL ?? "https://dashboard.betelgeze.com").toString()
        const verifyToken = process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN
        if (!verifyToken) throw new Error("The Betelgeze WhatsApp webhook verification token is not configured.")
        const subscription = await fetch(`https://graph.facebook.com/v25.0/${encodeURIComponent(input.wabaId)}/subscribed_apps`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenPayload.access_token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ override_callback_uri: webhookUrl, verify_token: verifyToken }),
        })
        if (!subscription.ok) throw new Error("WhatsApp was authorized, but Meta could not subscribe Betelgeze to its webhooks.")
        await stageWorkspaceIntegrationCandidate({
            workspaceId: workspace.id,
            provider: "meta_whatsapp",
            authMethod: "embedded_signup",
            userId: user.id,
            config: {
                access_token: tokenPayload.access_token,
                phone_number_id: input.phoneNumberId,
                waba_id: input.wabaId,
                webhook_verify_token: verifyToken,
                consent_template_name: input.consentTemplateName.trim(),
                consent_template_language: input.consentTemplateLanguage.trim() || "en_US",
            },
        })
        await verifyAndActivateWorkspaceIntegrationCandidate(workspace.id, "meta_whatsapp")
        refresh(slug)
    })
}

export async function verifyPendingWorkspaceConnection(slug: string, provider: IntegrationProvider): Promise<WorkspaceConnectionActionResult> {
    return connectionAction(async () => {
        const { workspace } = await requireWorkspace(slug, "owner")
        await verifyAndActivateWorkspaceIntegrationCandidate(workspace.id, provider)
        refresh(slug)
    })
}

export async function discardPendingWorkspaceConnection(slug: string, provider: IntegrationProvider): Promise<WorkspaceConnectionActionResult> {
    return connectionAction(async () => {
        const { workspace } = await requireWorkspace(slug, "owner")
        await discardWorkspaceIntegrationCandidate(workspace.id, provider)
        refresh(slug)
    })
}

export async function rollbackWorkspaceConnection(slug: string, provider: IntegrationProvider): Promise<WorkspaceConnectionActionResult> {
    return connectionAction(async () => {
        const { workspace } = await requireWorkspace(slug, "owner")
        await restorePreviousWorkspaceIntegration(workspace.id, provider)
        refresh(slug)
    })
}

export async function disconnectWorkspaceConnection(slug: string, provider: IntegrationProvider): Promise<WorkspaceConnectionActionResult> {
    return connectionAction(async () => {
        const { workspace } = await requireWorkspace(slug, "owner")
        await disconnectWorkspaceIntegration(workspace.id, provider)
        refresh(slug)
    })
}

export async function saveWorkspaceOnboardingDomain(slug: string, formData: FormData) {
    const { workspace } = await requireWorkspace(slug, "admin")
    const submitted = String(formData.get("domain") ?? "")
    const domain = submitted ? normalizeOnboardingDomain(submitted) : null
    if (submitted && !domain) throw new Error("Enter a valid hostname, such as onboarding.example.com.")

    const platformHost = process.env.NEXT_PUBLIC_SITE_URL
        ? new URL(process.env.NEXT_PUBLIC_SITE_URL).hostname.toLowerCase()
        : null
    if (domain && domain === platformHost) throw new Error("Use a separate custom domain, not the Betelgeze application domain.")

    if (domain && domain !== workspace.custom_onboarding_domain) {
        const { data: assignedWorkspace } = await supabaseAdmin
            .from("workspaces")
            .select("id")
            .ilike("custom_onboarding_domain", domain)
            .neq("id", workspace.id)
            .maybeSingle()
        if (assignedWorkspace) throw new Error("That onboarding domain is already assigned to another workspace.")
    }

    if (!domain) {
        if (workspace.custom_onboarding_domain) {
            await removeOnboardingDomain(workspace.custom_onboarding_domain)
            await removeDirectUploadsFromDomain(workspace.custom_onboarding_domain)
        }
        const { error } = await supabaseAdmin
            .from("workspaces")
            .update({ custom_onboarding_domain: null, custom_onboarding_domain_status: "none", custom_onboarding_domain_records: [], custom_onboarding_domain_verified_at: null, custom_onboarding_domain_error: null })
            .eq("id", workspace.id)
        if (error) throw new Error("Could not remove the onboarding domain.")
        refresh(slug)
        return
    }

    if (
        domain === workspace.custom_onboarding_domain &&
        workspace.custom_onboarding_domain_status === "verified"
    ) {
        refresh(slug)
        return
    }

    const provisioned = await attachOnboardingDomain(domain)

    const { error } = await supabaseAdmin
        .from("workspaces")
        .update({
            custom_onboarding_domain: domain,
            custom_onboarding_domain_status: "pending_dns",
            custom_onboarding_domain_records: provisioned.records,
            custom_onboarding_domain_verified_at: null,
            custom_onboarding_domain_error: null,
        })
        .eq("id", workspace.id)
    if (error?.code === "23505") throw new Error("That onboarding domain is already assigned to another workspace.")
    if (error) throw new Error("Could not save the onboarding domain.")
    if (workspace.custom_onboarding_domain && workspace.custom_onboarding_domain !== domain) {
        await removeOnboardingDomain(workspace.custom_onboarding_domain)
        await removeDirectUploadsFromDomain(workspace.custom_onboarding_domain)
    }
    refresh(slug)
}

export async function verifyWorkspaceOnboardingDomain(slug: string) {
    const { workspace } = await requireWorkspace(slug, "admin")
    if (!workspace.custom_onboarding_domain) throw new Error("Add a domain before verifying it.")
    const verified = await verifyOnboardingDomain(workspace.custom_onboarding_domain)
    let connectionError = verified.error
    if (verified.verified) {
        try {
            await allowDirectUploadsFromDomain(workspace.custom_onboarding_domain)
        } catch (error) {
            connectionError = error instanceof Error ? error.message : "Could not configure browser uploads for this domain."
        }
    }
    const { error } = await supabaseAdmin
        .from("workspaces")
        .update({
            custom_onboarding_domain_status: verified.verified && !connectionError ? "verified" : "pending_dns",
            custom_onboarding_domain_records: verified.records,
            custom_onboarding_domain_verified_at: verified.verified && !connectionError ? new Date().toISOString() : null,
            custom_onboarding_domain_error: connectionError,
        })
        .eq("id", workspace.id)
    if (error) throw new Error("Could not save the domain verification result.")
    refresh(slug)
}

export async function cancelWorkspaceOnboardingDomain(slug: string) {
    const { workspace } = await requireWorkspace(slug, "admin")
    if (!workspace.custom_onboarding_domain) return

    await removeOnboardingDomain(workspace.custom_onboarding_domain)
    await removeDirectUploadsFromDomain(workspace.custom_onboarding_domain)
    const { error } = await supabaseAdmin
        .from("workspaces")
        .update({
            custom_onboarding_domain: null,
            custom_onboarding_domain_status: "none",
            custom_onboarding_domain_records: [],
            custom_onboarding_domain_verified_at: null,
            custom_onboarding_domain_error: null,
        })
        .eq("id", workspace.id)
    if (error) throw new Error("Could not cancel the onboarding domain setup.")
    refresh(slug)
}
