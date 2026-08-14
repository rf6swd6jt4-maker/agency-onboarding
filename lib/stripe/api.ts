import { getRequiredEnv } from "@/lib/env"
import { verifyStripeWebhookSignature } from "@/lib/stripe/signature"
import { getStripeCustomerPhone } from "@/lib/stripe/format"

const STRIPE_API_BASE = "https://api.stripe.com/v1"

type StripeRequestOptions = {
    method?: "GET" | "POST"
    params?: Record<string, string | number | boolean | null | undefined>
    idempotencyKey?: string
}

export type StripeCheckoutLineItemInput = {
    serviceKey: string
    name?: string
    description: string
    amount: number
    billingComponent: "upfront" | "recurring"
    imageUrl?: string | null
}

export type StripeRecurringInterval = "week" | "month" | "year"

export type CreateStripeMixedCheckoutInput = {
    saleId: string
    relationshipId: string
    workspaceId: string
    name: string
    email: string
    phone?: string | null
    currency: string
    lineItems: StripeCheckoutLineItemInput[]
    serviceKeys: string[]
    projectTimeframeDays?: number | null
    interval?: StripeRecurringInterval | null
    intervalCount?: number | null
    successUrl: string
    cancelUrl: string
    expiresAt: number
    secretKey?: string
    idempotencyKey?: string
}

export type StripeCheckoutResult = {
    customerId: string
    checkoutSessionId: string
    checkoutStatus: string | null
    checkoutUrl: string
    expiresAt: string | null
    rawCheckout: unknown
}

export type StripeWebhookEvent = {
    id: string
    type: string
    livemode?: boolean
    account?: string
    context?: string
    data?: {
        object?: Record<string, unknown>
    }
}

function getStripeSecretKey() {
    return getRequiredEnv("STRIPE_SECRET_KEY")
}

export function hasStripeConfig() {
    return Boolean(process.env.STRIPE_SECRET_KEY)
}

export async function getStripeBalance() {
    const balance = await stripeRequest("/balance", { method: "GET" })

    const value = balance as {
        available?: Array<{ amount?: unknown; currency?: unknown }>
        pending?: Array<{ amount?: unknown; currency?: unknown }>
    }
    const normalize = (entries: unknown) =>
        Array.isArray(entries)
            ? entries.flatMap((entry) => {
                  if (!entry || typeof entry !== "object") return []
                  const item = entry as { amount?: unknown; currency?: unknown }
                  return typeof item.amount === "number" && typeof item.currency === "string"
                      ? [{ amount: item.amount, currency: item.currency }]
                      : []
              })
            : []

    return {
        available: normalize(value.available),
        pending: normalize(value.pending),
    }
}

function appendStripeParam(
    params: URLSearchParams,
    key: string,
    value: string | number | boolean | null | undefined
) {
    if (value === null || value === undefined) return

    params.append(key, String(value))
}

async function stripeRequest(
    path: string,
    { method = "POST", params = {}, idempotencyKey }: StripeRequestOptions = {},
    secretKey = getStripeSecretKey()
) {
    const body = new URLSearchParams()

    for (const [key, value] of Object.entries(params)) {
        appendStripeParam(body, key, value)
    }
    const encodedParams = body.toString()
    const requestUrl = `${STRIPE_API_BASE}${path}${
        method === "GET" && encodedParams ? `?${encodedParams}` : ""
    }`

    const response = await fetch(requestUrl, {
        method,
        headers: {
            Authorization: `Bearer ${secretKey}`,
            "Content-Type": "application/x-www-form-urlencoded",
            ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: method === "POST" ? encodedParams : undefined,
    })
    const responseBody = await response.text()

    if (!response.ok) {
        throw new Error(
            `Stripe ${path} failed with ${response.status}: ${responseBody}`
        )
    }

    return responseBody ? JSON.parse(responseBody) : null
}

function asStripeId(response: unknown, label: string) {
    const id =
        response && typeof response === "object" && !Array.isArray(response)
            ? (response as { id?: unknown }).id
            : null

    if (typeof id !== "string" || !id.trim()) {
        throw new Error(`Stripe did not return a ${label} ID`)
    }

    return id
}

export function getCheckoutFields(checkout: unknown) {
    const value = checkout && typeof checkout === "object" && !Array.isArray(checkout)
        ? checkout as { id?: unknown; status?: unknown; payment_status?: unknown; url?: unknown; expires_at?: unknown; customer?: unknown; subscription?: unknown; metadata?: unknown }
        : {}
    return {
        checkoutSessionId: typeof value.id === "string" && value.id.trim() ? value.id : null,
        checkoutStatus: typeof value.status === "string" ? value.status : null,
        checkoutUrl: typeof value.url === "string" && value.url.trim() ? value.url : null,
        expiresAt: typeof value.expires_at === "number"
            ? new Date(value.expires_at * 1_000).toISOString()
            : null,
        paymentStatus: typeof value.payment_status === "string" ? value.payment_status : null,
        customerId: typeof value.customer === "string" ? value.customer : null,
        subscriptionId: typeof value.subscription === "string" ? value.subscription : null,
        metadata: value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata) ? value.metadata as Record<string, unknown> : {},
    }
}

export async function createStripeMixedCheckout({
    saleId,
    relationshipId,
    workspaceId,
    name,
    email,
    phone,
    currency,
    lineItems,
    serviceKeys,
    projectTimeframeDays,
    interval,
    intervalCount,
    successUrl,
    cancelUrl,
    expiresAt,
    secretKey,
    idempotencyKey,
}: CreateStripeMixedCheckoutInput): Promise<StripeCheckoutResult> {
    const recurringItems = lineItems.filter((item) => item.billingComponent === "recurring")
    const upfrontItems = lineItems.filter((item) => item.billingComponent === "upfront")
    if (!lineItems.length || lineItems.some((item) => !Number.isInteger(item.amount) || item.amount <= 0)) {
        throw new Error("Stripe Checkout requires at least one positive line item")
    }
    if (recurringItems.length > 20 || upfrontItems.length > (recurringItems.length ? 20 : 100)) {
        throw new Error("This sale has too many separate Stripe Checkout line items")
    }
    const recurring = recurringItems.length > 0
    if (recurring && (!interval || !intervalCount || intervalCount < 1)) {
        throw new Error("A recurring Checkout requires a billing schedule")
    }

    const key = secretKey ?? getStripeSecretKey()
    const customer = await stripeRequest("/customers", {
        idempotencyKey: `${saleId}:customer`,
        params: {
            name,
            email,
            phone: getStripeCustomerPhone(phone),
            "metadata[client_sale_id]": saleId,
            "metadata[relationship_id]": relationshipId,
            "metadata[workspace_id]": workspaceId,
        },
    }, key)
    const customerId = asStripeId(customer, "customer")
    const params: Record<string, string | number | boolean | null | undefined> = {
        mode: recurring ? "subscription" : "payment",
        customer: customerId,
        client_reference_id: saleId,
        success_url: successUrl,
        cancel_url: cancelUrl,
        expires_at: expiresAt,
        billing_address_collection: "required",
        "phone_number_collection[enabled]": true,
        submit_type: recurring ? "subscribe" : "pay",
        "custom_text[submit][message]": recurring
            ? "This payment includes the upfront fees and first recurring period shown above."
            : "This is the full one-time amount shown above.",
        "metadata[client_sale_id]": saleId,
        "metadata[relationship_id]": relationshipId,
        "metadata[workspace_id]": workspaceId,
    }

    if (recurring) {
        params["subscription_data[metadata][client_sale_id]"] = saleId
        params["subscription_data[metadata][relationship_id]"] = relationshipId
        params["subscription_data[metadata][workspace_id]"] = workspaceId
        params["subscription_data[metadata][service_keys]"] = serviceKeys.join(",")
        params["subscription_data[metadata][project_timeframe_days]"] =
            projectTimeframeDays ?? undefined
    } else {
        params["invoice_creation[enabled]"] = true
        params["invoice_creation[invoice_data][metadata][client_sale_id]"] = saleId
        params["invoice_creation[invoice_data][metadata][relationship_id]"] = relationshipId
        params["invoice_creation[invoice_data][metadata][workspace_id]"] = workspaceId
        params["payment_intent_data[metadata][client_sale_id]"] = saleId
        params["payment_intent_data[metadata][relationship_id]"] = relationshipId
        params["payment_intent_data[metadata][workspace_id]"] = workspaceId
        params["payment_intent_data[metadata][service_keys]"] = serviceKeys.join(",")
        params["payment_intent_data[metadata][project_timeframe_days]"] =
            projectTimeframeDays ?? undefined
    }

    for (const [index, item] of lineItems.entries()) {
        const base = `line_items[${index}]`
        const componentLabel = item.billingComponent === "upfront" ? "Upfront" : "Recurring"
        params[`${base}[quantity]`] = 1
        params[`${base}[price_data][currency]`] = currency
        params[`${base}[price_data][unit_amount]`] = item.amount
        params[`${base}[price_data][product_data][name]`] =
            `${item.name || item.description} — ${componentLabel}`
        params[`${base}[price_data][product_data][description]`] = item.description
        params[`${base}[price_data][product_data][metadata][service_key]`] = item.serviceKey
        params[`${base}[price_data][product_data][metadata][billing_component]`] =
            item.billingComponent
        if (item.billingComponent === "recurring") {
            params[`${base}[price_data][recurring][interval]`] = interval
            params[`${base}[price_data][recurring][interval_count]`] = intervalCount
        }
        if (item.imageUrl) {
            params[`${base}[price_data][product_data][images][0]`] = item.imageUrl
        }
    }

    const checkout = await stripeRequest("/checkout/sessions", {
        idempotencyKey: idempotencyKey ?? `${saleId}:mixed-checkout`,
        params,
    }, key)
    const fields = getCheckoutFields(checkout)
    if (!fields.checkoutSessionId || !fields.checkoutUrl) {
        throw new Error("Stripe did not return a usable Checkout page")
    }
    return {
        customerId,
        checkoutSessionId: fields.checkoutSessionId,
        checkoutStatus: fields.checkoutStatus,
        checkoutUrl: fields.checkoutUrl,
        expiresAt: fields.expiresAt,
        rawCheckout: checkout,
    }
}

export async function retrieveStripeCheckoutSession(input: { checkoutSessionId: string; secretKey?: string }) {
    return stripeRequest(`/checkout/sessions/${encodeURIComponent(input.checkoutSessionId)}`, { method: "GET" }, input.secretKey ?? getStripeSecretKey())
}

export { verifyStripeWebhookSignature }
