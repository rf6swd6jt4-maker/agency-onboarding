import { NextRequest } from "next/server"
import { createOrReuseOnboardingCheckout } from "@/lib/client-sales/onboarding-checkout"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params
    try {
        const result = await createOrReuseOnboardingCheckout({ token, origin: request.nextUrl.origin })
        const destination = result.paid ? new URL(`/onboarding/session/${token}`, request.url) : new URL(result.checkoutUrl!)
        return Response.redirect(destination, 303)
    } catch (error) {
        console.error("Could not open onboarding Checkout", error instanceof Error ? error.message : "Unknown Checkout error")
        const destination = new URL(`/onboarding/session/${token}`, request.url)
        destination.searchParams.set("payment", "unavailable")
        destination.searchParams.set("reason", "Payment is temporarily unavailable. Please try again or contact the team for help.")
        return Response.redirect(destination, 303)
    }
}
