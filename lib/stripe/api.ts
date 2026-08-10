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
    description: string
    amount: number
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

export type StripeWebhookEvent = {
    id: string
    type: string
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

export { verifyStripeWebhookSignature }
