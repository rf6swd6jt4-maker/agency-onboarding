import { getRequiredEnv } from "@/lib/env"
import { verifyStripeWebhookSignature } from "@/lib/stripe/signature"
import { getStripeCustomerPhone } from "@/lib/stripe/format"

const STRIPE_API_BASE = "https://api.stripe.com/v1"

type StripeRequestOptions = {
    method?: "GET" | "POST"
    params?: Record<string, string | number | boolean | null | undefined>
    idempotencyKey?: string
}

export type StripeInvoiceLineItemInput = {
    serviceKey: string
    name?: string
    description: string
    amount: number
    imageUrl?: string | null
}

export type StripeRecurringInterval = "week" | "month" | "year"

export type CreateStripeSubscriptionCheckoutInput = {
    saleId: string
    relationshipId: string
    workspaceId: string
    name: string
    email: string
    phone?: string | null
    currency: string
    lineItems: StripeInvoiceLineItemInput[]
    serviceKeys: string[]
    projectTimeframeDays?: number | null
    interval: StripeRecurringInterval
    intervalCount: number
    successUrl: string
    cancelUrl: string
    expiresAt: number
    secretKey?: string
    idempotencyKey?: string
}

export type CreateStripePaymentCheckoutInput = Omit<CreateStripeSubscriptionCheckoutInput, "interval" | "intervalCount"> & {
    idempotencyKey?: string
}

export type CreateStripeInvoiceInput = {
    saleId: string
    name: string
    email?: string | null
    phone?: string | null
    currency: string
    lineItems: StripeInvoiceLineItemInput[]
    serviceKeys: string[]
    projectTimeframeDays?: number | null
    daysUntilDue: number
    secretKey?: string
}

export type StripeInvoiceResult = {
    customerId: string
    invoiceId: string
    invoiceStatus: string | null
    hostedInvoiceUrl: string | null
    invoicePdf: string | null
    rawInvoice: unknown
}

export type VoidStripeInvoiceResult = {
    invoiceId: string
    invoiceStatus: string
    rawInvoice: unknown
}

export type StripeSubscriptionCheckoutResult = {
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

function getInvoiceFields(invoice: unknown) {
    const value =
        invoice && typeof invoice === "object" && !Array.isArray(invoice)
            ? (invoice as {
                  id?: unknown
                  status?: unknown
                  hosted_invoice_url?: unknown
                  invoice_pdf?: unknown
                  amount_due?: unknown
                  total?: unknown
              })
            : {}

    return {
        invoiceId:
            typeof value.id === "string" && value.id.trim()
                ? value.id.trim()
                : null,
        invoiceStatus:
            typeof value.status === "string" ? value.status : null,
        hostedInvoiceUrl:
            typeof value.hosted_invoice_url === "string"
                ? value.hosted_invoice_url
                : null,
        invoicePdf:
            typeof value.invoice_pdf === "string" ? value.invoice_pdf : null,
        amountDue:
            typeof value.amount_due === "number" ? value.amount_due : null,
        total: typeof value.total === "number" ? value.total : null,
    }
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

export async function createAndSendStripeInvoice({
    saleId,
    name,
    email,
    phone,
    currency,
    lineItems,
    serviceKeys,
    projectTimeframeDays,
    daysUntilDue,
    secretKey,
}: CreateStripeInvoiceInput): Promise<StripeInvoiceResult> {
    const key = secretKey ?? getStripeSecretKey()
    const customer = await stripeRequest("/customers", {
        idempotencyKey: `${saleId}:customer`,
        params: {
            name,
            email: email || undefined,
            phone: getStripeCustomerPhone(phone),
            "metadata[client_sale_id]": saleId,
        },
    }, key)
    const customerId = asStripeId(customer, "customer")

    const invoice = await stripeRequest("/invoices", {
        idempotencyKey: `${saleId}:invoice`,
        params: {
            customer: customerId,
            collection_method: "send_invoice",
            days_until_due: daysUntilDue,
            "metadata[client_sale_id]": saleId,
            "metadata[service_keys]": serviceKeys.join(","),
            "metadata[project_timeframe_days]":
                projectTimeframeDays ?? undefined,
        },
    }, key)
    const draftInvoiceId = asStripeId(invoice, "invoice")

    for (const [lineItemIndex, lineItem] of lineItems.entries()) {
        const invoiceItem = await stripeRequest("/invoiceitems", {
            idempotencyKey: `${saleId}:invoice-item:${lineItemIndex}`,
            params: {
                customer: customerId,
                invoice: draftInvoiceId,
                amount: lineItem.amount,
                currency,
                description: lineItem.description,
                "metadata[client_sale_id]": saleId,
                "metadata[service_key]": lineItem.serviceKey,
            },
        }, key)
        const attachedInvoice =
            invoiceItem &&
            typeof invoiceItem === "object" &&
            !Array.isArray(invoiceItem)
                ? (invoiceItem as { invoice?: unknown }).invoice
                : null

        if (attachedInvoice !== draftInvoiceId) {
            throw new Error(
                `Stripe invoice item for ${lineItem.description} was not attached to draft invoice ${draftInvoiceId}`
            )
        }
    }

    const expectedTotal = lineItems.reduce(
        (total, lineItem) => total + lineItem.amount,
        0
    )
    const draftInvoice = await stripeRequest(
        `/invoices/${encodeURIComponent(draftInvoiceId)}`,
        {
            method: "GET",
        }, key
    )
    const draftFields = getInvoiceFields(draftInvoice)
    const actualTotal = draftFields.total ?? draftFields.amountDue

    if (actualTotal !== expectedTotal) {
        throw new Error(
            `Stripe draft invoice total mismatch. Expected ${expectedTotal}, got ${actualTotal ?? "unknown"}. Invoice was not sent.`
        )
    }

    const finalizedInvoice = await stripeRequest(
        `/invoices/${encodeURIComponent(draftInvoiceId)}/finalize`, { idempotencyKey: `${saleId}:finalize` }, key
    )
    const { invoiceId } = getInvoiceFields(finalizedInvoice)

    if (!invoiceId) {
        throw new Error("Stripe did not return a finalized invoice ID")
    }

    const sentInvoice = await stripeRequest(
        `/invoices/${encodeURIComponent(invoiceId)}/send`, { idempotencyKey: `${saleId}:send` }, key
    )
    const sentFields = getInvoiceFields(sentInvoice)

    return {
        customerId,
        invoiceId,
        invoiceStatus: sentFields.invoiceStatus,
        hostedInvoiceUrl: sentFields.hostedInvoiceUrl,
        invoicePdf: sentFields.invoicePdf,
        rawInvoice: sentInvoice,
    }
}

export async function createStripeSubscriptionCheckout({
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
}: CreateStripeSubscriptionCheckoutInput): Promise<StripeSubscriptionCheckoutResult> {
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
        mode: "subscription",
        customer: customerId,
        client_reference_id: saleId,
        success_url: successUrl,
        cancel_url: cancelUrl,
        expires_at: expiresAt,
        billing_address_collection: "required",
        "phone_number_collection[enabled]": true,
        submit_type: "subscribe",
        "custom_text[submit][message]": "Your first payment starts the recurring service schedule shown above.",
        "metadata[client_sale_id]": saleId,
        "metadata[relationship_id]": relationshipId,
        "metadata[workspace_id]": workspaceId,
        "subscription_data[metadata][client_sale_id]": saleId,
        "subscription_data[metadata][relationship_id]": relationshipId,
        "subscription_data[metadata][workspace_id]": workspaceId,
        "subscription_data[metadata][service_keys]": serviceKeys.join(","),
        "subscription_data[metadata][project_timeframe_days]": projectTimeframeDays ?? undefined,
    }

    for (const [index, item] of lineItems.entries()) {
        const base = `line_items[${index}]`
        params[`${base}[quantity]`] = 1
        params[`${base}[price_data][currency]`] = currency
        params[`${base}[price_data][unit_amount]`] = item.amount
        params[`${base}[price_data][recurring][interval]`] = interval
        params[`${base}[price_data][recurring][interval_count]`] = intervalCount
        params[`${base}[price_data][product_data][name]`] = item.name || item.description
        params[`${base}[price_data][product_data][description]`] = item.description
        params[`${base}[price_data][product_data][metadata][service_key]`] = item.serviceKey
        if (item.imageUrl) params[`${base}[price_data][product_data][images][0]`] = item.imageUrl
    }

    const checkout = await stripeRequest("/checkout/sessions", {
        idempotencyKey: idempotencyKey ?? `${saleId}:subscription-checkout`,
        params,
    }, key)
    const fields = getCheckoutFields(checkout)
    if (!fields.checkoutSessionId || !fields.checkoutUrl) {
        throw new Error("Stripe did not return a usable recurring Checkout page")
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

export async function createStripePaymentCheckout({
    saleId, relationshipId, workspaceId, name, email, phone, currency, lineItems,
    serviceKeys, projectTimeframeDays, successUrl, cancelUrl, expiresAt, secretKey,
    idempotencyKey,
}: CreateStripePaymentCheckoutInput): Promise<StripeSubscriptionCheckoutResult> {
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
        mode: "payment",
        customer: customerId,
        client_reference_id: saleId,
        success_url: successUrl,
        cancel_url: cancelUrl,
        expires_at: expiresAt,
        billing_address_collection: "required",
        "phone_number_collection[enabled]": true,
        submit_type: "pay",
        "invoice_creation[enabled]": true,
        "invoice_creation[invoice_data][metadata][client_sale_id]": saleId,
        "invoice_creation[invoice_data][metadata][relationship_id]": relationshipId,
        "invoice_creation[invoice_data][metadata][workspace_id]": workspaceId,
        "metadata[client_sale_id]": saleId,
        "metadata[relationship_id]": relationshipId,
        "metadata[workspace_id]": workspaceId,
        "payment_intent_data[metadata][client_sale_id]": saleId,
        "payment_intent_data[metadata][relationship_id]": relationshipId,
        "payment_intent_data[metadata][workspace_id]": workspaceId,
        "payment_intent_data[metadata][service_keys]": serviceKeys.join(","),
        "payment_intent_data[metadata][project_timeframe_days]": projectTimeframeDays ?? undefined,
    }
    for (const [index, item] of lineItems.entries()) {
        const base = `line_items[${index}]`
        params[`${base}[quantity]`] = 1
        params[`${base}[price_data][currency]`] = currency
        params[`${base}[price_data][unit_amount]`] = item.amount
        params[`${base}[price_data][product_data][name]`] = item.name || item.description
        params[`${base}[price_data][product_data][description]`] = item.description
        params[`${base}[price_data][product_data][metadata][service_key]`] = item.serviceKey
        if (item.imageUrl) params[`${base}[price_data][product_data][images][0]`] = item.imageUrl
    }
    const checkout = await stripeRequest("/checkout/sessions", {
        idempotencyKey: idempotencyKey ?? `${saleId}:payment-checkout`,
        params,
    }, key)
    const fields = getCheckoutFields(checkout)
    if (!fields.checkoutSessionId || !fields.checkoutUrl) throw new Error("Stripe did not return a usable Checkout page")
    return { customerId, checkoutSessionId: fields.checkoutSessionId, checkoutStatus: fields.checkoutStatus, checkoutUrl: fields.checkoutUrl, expiresAt: fields.expiresAt, rawCheckout: checkout }
}

export async function retrieveStripeCheckoutSession(input: { checkoutSessionId: string; secretKey?: string }) {
    return stripeRequest(`/checkout/sessions/${encodeURIComponent(input.checkoutSessionId)}`, { method: "GET" }, input.secretKey ?? getStripeSecretKey())
}

export async function voidStripeInvoice(input: {
    invoiceId: string
    secretKey?: string
    idempotencyKey: string
}): Promise<VoidStripeInvoiceResult> {
    const invoice = await stripeRequest(
        `/invoices/${encodeURIComponent(input.invoiceId)}/void`,
        { idempotencyKey: input.idempotencyKey },
        input.secretKey ?? getStripeSecretKey(),
    )
    const fields = getInvoiceFields(invoice)
    if (!fields.invoiceId || fields.invoiceStatus !== "void") {
        throw new Error("Stripe did not confirm that the invoice was voided")
    }
    return {
        invoiceId: fields.invoiceId,
        invoiceStatus: fields.invoiceStatus,
        rawInvoice: invoice,
    }
}

export async function expireStripeCheckoutSession(input: {
    checkoutSessionId: string
    secretKey?: string
    idempotencyKey: string
}) {
    const checkout = await stripeRequest(
        `/checkout/sessions/${encodeURIComponent(input.checkoutSessionId)}/expire`,
        { idempotencyKey: input.idempotencyKey },
        input.secretKey ?? getStripeSecretKey(),
    )
    const fields = getCheckoutFields(checkout)
    if (!fields.checkoutSessionId || fields.checkoutStatus !== "expired") {
        throw new Error("Stripe did not confirm that the Checkout page was expired")
    }
    return { ...fields, rawCheckout: checkout }
}

export { verifyStripeWebhookSignature }
