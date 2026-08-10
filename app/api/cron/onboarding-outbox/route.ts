import { timingSafeEqual } from "crypto"
import { NextRequest } from "next/server"
import { processAllOnboardingOutboxes } from "@/lib/onboarding/outbox"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

function authorized(request: NextRequest) {
    const secret = process.env.CRON_SECRET?.trim()
    const authorization = request.headers.get("authorization")
    if (!secret || !authorization?.startsWith("Bearer ")) return false
    const supplied = authorization.slice("Bearer ".length)
    const expectedBytes = Buffer.from(secret)
    const suppliedBytes = Buffer.from(supplied)
    return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes)
}

async function processRequest(request: NextRequest) {
    if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 })
    try {
        const outcome = await processAllOnboardingOutboxes(25)
        return Response.json({
            ok: outcome.processorErrors === 0,
            workspaceCount: outcome.workspaceCount,
            deliveryClaimed: outcome.deliveryClaimed,
            deliverySent: outcome.deliverySent,
            deliveryFailed: outcome.deliveryFailed,
            cleanupClaimed: outcome.cleanupClaimed,
            cleanupCompleted: outcome.cleanupCompleted,
            cleanupFailed: outcome.cleanupFailed,
            processorErrors: outcome.processorErrors,
        }, { status: outcome.processorErrors > 0 ? 503 : 200 })
    } catch {
        return Response.json({ error: "Onboarding outbox discovery failed" }, { status: 503 })
    }
}

export async function GET(request: NextRequest) {
    return processRequest(request)
}

export async function POST(request: NextRequest) {
    return processRequest(request)
}
