import { NextRequest } from "next/server"
import { handleCompletedStripeCheckout } from "@/lib/client-sales/automation"
import { getOnboardingPaymentReturnUrl, onboardingPaymentReturnUrl, retrieveOnboardingCheckout } from "@/lib/client-sales/onboarding-checkout"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params
    const checkoutSessionId = request.nextUrl.searchParams.get("session_id")
    const fallbackReturnUrl = await getOnboardingPaymentReturnUrl(token)
    const fallbackDestination = new URL(fallbackReturnUrl ?? `/onboarding/session/${token}`, request.url)
    if (!checkoutSessionId) {
        fallbackDestination.searchParams.set("payment", "pending")
        return Response.redirect(fallbackDestination, 303)
    }
    try {
        const { context, checkout } = await retrieveOnboardingCheckout({ token, checkoutSessionId })
        const result = await handleCompletedStripeCheckout(checkout as Record<string, unknown>, context.workspaceId)
        const destination = new URL(onboardingPaymentReturnUrl(context, token))
        destination.searchParams.set("payment", result.ok && !("reason" in result && result.reason === "payment_pending") ? "paid" : "pending")
        return Response.redirect(destination, 303)
    } catch {
        fallbackDestination.searchParams.set("payment", "pending")
        return Response.redirect(fallbackDestination, 303)
    }
}
