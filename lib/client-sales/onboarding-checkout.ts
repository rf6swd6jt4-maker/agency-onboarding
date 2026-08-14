import { createStripeMixedCheckout, retrieveStripeCheckoutSession, type StripeCheckoutLineItemInput, type StripeRecurringInterval } from "@/lib/stripe/api"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { getWorkspaceProviderConfig } from "@/lib/workspace-integrations"
import { createPrivateUploadSignedUrl, createServiceThumbnailPublicUrl } from "@/lib/onboarding/uploads"
import { defaultOnboardingPaymentDefinition, type OnboardingPaymentDefinitionV2 } from "@/lib/onboarding/block-definition"
import { normalizeVisualPaymentGate } from "@/lib/onboarding/block-validation"
import { getOnboardingUrl } from "@/lib/onboarding/custom-domain"

type PaymentContext = {
    sessionId: string
    workspaceId: string
    relationshipId: string
    workspace: {
        slug: string
        custom_onboarding_domain: string | null
        custom_onboarding_domain_status: string | null
    }
    sale: {
        id: string
        status: string
        billing_interval: StripeRecurringInterval | null
        billing_interval_count: number | null
        upfront_total_amount: number
        recurring_total_amount: number
        client_name: string
        client_email: string | null
        client_phone: string
        currency: string | null
        project_timeframe_days: number | null
        stripe_checkout_session_id: string | null
        stripe_checkout_url: string | null
        stripe_checkout_expires_at: string | null
    }
}

export async function getOnboardingPaymentContext(token: string): Promise<PaymentContext | null> {
    const { data: session, error: sessionError } = await supabaseAdmin.from("relationship_onboarding_sessions")
        .select("id, workspace_id, relationship_id, source_sale_id")
        .eq("session_token", token).in("status", ["active", "completed"]).maybeSingle()
    if (sessionError || !session?.source_sale_id) return null
    const { data: workspace, error: workspaceError } = await supabaseAdmin.from("workspaces")
        .select("slug, custom_onboarding_domain, custom_onboarding_domain_status")
        .eq("id", session.workspace_id).maybeSingle()
    if (workspaceError || !workspace) return null
    const { data: sale, error: saleError } = await supabaseAdmin.from("client_sales")
        .select("id, status, billing_interval, billing_interval_count, upfront_total_amount, recurring_total_amount, client_name, client_email, client_phone, currency, project_timeframe_days, stripe_checkout_session_id, stripe_checkout_url, stripe_checkout_expires_at")
        .eq("workspace_id", session.workspace_id).eq("id", session.source_sale_id).maybeSingle()
    if (saleError || !sale) return null
    return {
        sessionId: session.id,
        workspaceId: session.workspace_id,
        relationshipId: session.relationship_id,
        workspace,
        sale: sale as PaymentContext["sale"],
    }
}

export function onboardingPaymentReturnUrl(context: PaymentContext, token: string) {
    return getOnboardingUrl({
        workspaceSlug: context.workspace.slug,
        sessionToken: token,
        customDomain: context.workspace.custom_onboarding_domain,
        customDomainVerified: context.workspace.custom_onboarding_domain_status === "verified",
    })
}

export async function getOnboardingPaymentReturnUrl(token: string) {
    const context = await getOnboardingPaymentContext(token)
    return context ? onboardingPaymentReturnUrl(context, token) : null
}

export function onboardingPaymentPending(context: PaymentContext | null) {
    return Boolean(context && !["paid", "test_paid"].includes(context.sale.status))
}

export async function getFrozenOnboardingPaymentDefinition(context: PaymentContext): Promise<OnboardingPaymentDefinitionV2> {
    const { data: sale } = await supabaseAdmin.from("client_sales").select("configuration_revision_id").eq("workspace_id", context.workspaceId).eq("id", context.sale.id).maybeSingle()
    if (!sale?.configuration_revision_id) return defaultOnboardingPaymentDefinition()
    const { data: revision } = await supabaseAdmin.from("onboarding_configuration_revisions").select("definition").eq("workspace_id", context.workspaceId).eq("id", sale.configuration_revision_id).maybeSingle()
    const root = revision?.definition && typeof revision.definition === "object" && !Array.isArray(revision.definition) ? revision.definition as Record<string, unknown> : {}
    const payment = root.payment_gate
    if (!payment || typeof payment !== "object" || Array.isArray(payment)) return defaultOnboardingPaymentDefinition()
    const normalized = normalizeVisualPaymentGate(payment as OnboardingPaymentDefinitionV2, { allowPendingVideo: true })
    return normalized.ok ? normalized.definition : defaultOnboardingPaymentDefinition()
}

async function frozenCheckoutLineItems(context: PaymentContext, expiresAt: number): Promise<StripeCheckoutLineItemInput[]> {
    const { data: items, error } = await supabaseAdmin.from("client_sale_items")
        .select("service_code, service_name, service_revision_id, description, upfront_amount_cents, recurring_amount_cents")
        .eq("workspace_id", context.workspaceId).eq("client_sale_id", context.sale.id).order("sort_order")
    if (error || !items?.length) throw new Error(error?.message ?? "This sale has no frozen services")
    const revisionIds = items.map((item) => item.service_revision_id).filter((id): id is string => Boolean(id))
    const { data: revisions } = revisionIds.length
        ? await supabaseAdmin.from("onboarding_service_revisions").select("id, definition").eq("workspace_id", context.workspaceId).in("id", revisionIds)
        : { data: [] }
    const definitionByRevision = new Map((revisions ?? []).map((revision) => [revision.id, revision.definition && typeof revision.definition === "object" ? revision.definition as Record<string, unknown> : {}]))
    const serviceItems = await Promise.all(items.map(async (item) => {
        const definition = definitionByRevision.get(item.service_revision_id ?? "") ?? {}
        const displayName = String(definition.checkoutDisplayName ?? definition.checkout_display_name ?? item.service_name)
        const description = String(definition.checkoutDescription ?? definition.checkout_description ?? item.description ?? displayName)
        const thumbnailPath = typeof definition.thumbnailPath === "string" ? definition.thumbnailPath : typeof definition.thumbnail_path === "string" ? definition.thumbnail_path : null
        const publicImage = createServiceThumbnailPublicUrl(thumbnailPath)
        const imageUrl = publicImage ?? (thumbnailPath ? await createPrivateUploadSignedUrl(thumbnailPath, Math.max(60, expiresAt - Math.floor(Date.now() / 1_000))) : null)
        return [
            item.upfront_amount_cents > 0 ? {
                serviceKey: item.service_code,
                name: displayName,
                description,
                amount: item.upfront_amount_cents,
                billingComponent: "upfront" as const,
                imageUrl,
            } : null,
            item.recurring_amount_cents > 0 ? {
                serviceKey: item.service_code,
                name: displayName,
                description,
                amount: item.recurring_amount_cents,
                billingComponent: "recurring" as const,
                imageUrl,
            } : null,
        ].filter(Boolean) as StripeCheckoutLineItemInput[]
    }))
    return serviceItems.flat()
}

export async function createOrReuseOnboardingCheckout(input: { token: string; origin: string }) {
    const context = await getOnboardingPaymentContext(input.token)
    if (!context) throw new Error("Payment is not available for this onboarding link")
    const returnUrl = onboardingPaymentReturnUrl(context, input.token)
    if (!onboardingPaymentPending(context)) return { paid: true as const, checkoutUrl: null, returnUrl }
    const existingExpiry = Date.parse(context.sale.stripe_checkout_expires_at ?? "")
    if (context.sale.stripe_checkout_url && Number.isFinite(existingExpiry) && existingExpiry > Date.now() + 60_000) {
        return { paid: false as const, checkoutUrl: context.sale.stripe_checkout_url, returnUrl }
    }
    if (!context.sale.client_email) throw new Error("A billing email is required before payment can begin")
    const expiresAt = Math.floor(Date.now() / 1_000) + 24 * 60 * 60 - 60
    const lineItems = await frozenCheckoutLineItems(context, expiresAt)
    const config = await getWorkspaceProviderConfig(context.workspaceId, "stripe")
    const generation = context.sale.stripe_checkout_expires_at ?? "initial"
    const shared = {
        saleId: context.sale.id,
        relationshipId: context.relationshipId,
        workspaceId: context.workspaceId,
        name: context.sale.client_name,
        email: context.sale.client_email,
        phone: context.sale.client_phone,
        currency: (context.sale.currency ?? "usd").toLowerCase(),
        lineItems,
        serviceKeys: lineItems.map((item) => item.serviceKey),
        projectTimeframeDays: context.sale.project_timeframe_days,
        successUrl: `${input.origin}/api/onboarding/session/${input.token}/payment-return?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${returnUrl}?payment=cancelled`,
        expiresAt,
        secretKey: config.access_token || config.secret_key,
        idempotencyKey: `${context.sale.id}:onboarding-checkout:${generation}`,
    }
    const checkout = await createStripeMixedCheckout({
        ...shared,
        interval: context.sale.recurring_total_amount > 0
            ? context.sale.billing_interval ?? "month"
            : null,
        intervalCount: context.sale.recurring_total_amount > 0
            ? context.sale.billing_interval_count ?? 1
            : null,
    })
    const { error: updateError } = await supabaseAdmin.from("client_sales").update({
        stripe_customer_id: checkout.customerId,
        stripe_checkout_session_id: checkout.checkoutSessionId,
        stripe_checkout_status: checkout.checkoutStatus,
        stripe_checkout_url: checkout.checkoutUrl,
        stripe_checkout_expires_at: checkout.expiresAt,
        updated_at: new Date().toISOString(),
    }).eq("workspace_id", context.workspaceId).eq("id", context.sale.id)
    if (updateError) throw new Error(updateError.message)
    return { paid: false as const, checkoutUrl: checkout.checkoutUrl, returnUrl }
}

export async function retrieveOnboardingCheckout(input: { token: string; checkoutSessionId: string }) {
    const context = await getOnboardingPaymentContext(input.token)
    if (!context || context.sale.stripe_checkout_session_id !== input.checkoutSessionId) throw new Error("This Checkout page does not belong to the onboarding link")
    const config = await getWorkspaceProviderConfig(context.workspaceId, "stripe")
    const checkout = await retrieveStripeCheckoutSession({ checkoutSessionId: input.checkoutSessionId, secretKey: config.access_token || config.secret_key })
    return { context, checkout }
}
