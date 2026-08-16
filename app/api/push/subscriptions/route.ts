import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/workspaces"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { webPushPublicKey } from "@/lib/push/chat-notifications"
import { PUSH_DEVICE_COOKIE, PUSH_DEVICE_COOKIE_MAX_AGE, UUID_PATTERN } from "@/lib/push/device"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type SubscriptionInput = {
    endpoint?: unknown
    keys?: { p256dh?: unknown; auth?: unknown }
}

function deviceId(request: NextRequest) {
    const current = request.cookies.get(PUSH_DEVICE_COOKIE)?.value
    return current && UUID_PATTERN.test(current) ? current : randomUUID()
}

function setDeviceCookie(response: NextResponse, value: string) {
    response.cookies.set(PUSH_DEVICE_COOKIE, value, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: PUSH_DEVICE_COOKIE_MAX_AGE,
    })
}

export async function GET(request: NextRequest) {
    const user = await getCurrentUser()
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 })
    const publicKey = webPushPublicKey()
    const currentDeviceId = request.cookies.get(PUSH_DEVICE_COOKIE)?.value
    const { data: subscription } = currentDeviceId && UUID_PATTERN.test(currentDeviceId)
        ? await supabaseAdmin.from("web_push_subscriptions").select("id").eq("user_id", user.id).eq("device_id", currentDeviceId).maybeSingle()
        : { data: null }
    return Response.json({ configured: Boolean(publicKey), publicKey, subscribed: Boolean(subscription) }, { headers: { "Cache-Control": "no-store" } })
}

export async function POST(request: NextRequest) {
    const user = await getCurrentUser()
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 })
    if (!webPushPublicKey()) return Response.json({ error: "Push notifications are not configured." }, { status: 503 })
    const input = await request.json().catch(() => null) as SubscriptionInput | null
    const endpoint = typeof input?.endpoint === "string" ? input.endpoint.trim() : ""
    const p256dh = typeof input?.keys?.p256dh === "string" ? input.keys.p256dh.trim() : ""
    const auth = typeof input?.keys?.auth === "string" ? input.keys.auth.trim() : ""
    if (!endpoint.startsWith("https://") || endpoint.length > 4096 || !p256dh || p256dh.length > 512 || !auth || auth.length > 512) {
        return Response.json({ error: "The browser returned an invalid push subscription." }, { status: 400 })
    }

    const currentDeviceId = deviceId(request)
    const { data: existingEndpoint, error: lookupError } = await supabaseAdmin.from("web_push_subscriptions").select("id, user_id, p256dh, auth").eq("endpoint", endpoint).maybeSingle()
    if (lookupError) return Response.json({ error: "Could not save this device." }, { status: 503 })
    if (existingEndpoint && existingEndpoint.user_id !== user.id && (existingEndpoint.p256dh !== p256dh || existingEndpoint.auth !== auth)) {
        return Response.json({ error: "This browser returned a conflicting push subscription." }, { status: 409 })
    }

    const cleanupResults = await Promise.all([
        supabaseAdmin.from("web_push_subscriptions").delete().eq("user_id", user.id).eq("device_id", currentDeviceId),
        existingEndpoint ? supabaseAdmin.from("web_push_subscriptions").delete().eq("id", existingEndpoint.id) : Promise.resolve({ error: null }),
    ])
    if (cleanupResults.some((result) => result.error)) return Response.json({ error: "Could not replace this device’s subscription." }, { status: 503 })
    const { error } = await supabaseAdmin.from("web_push_subscriptions").upsert({
        user_id: user.id,
        device_id: currentDeviceId,
        endpoint,
        p256dh,
        auth,
        user_agent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
        updated_at: new Date().toISOString(),
    }, { onConflict: "endpoint" })
    if (error) return Response.json({ error: "Could not save this device." }, { status: 503 })
    const response = NextResponse.json({ subscribed: true })
    setDeviceCookie(response, currentDeviceId)
    return response
}

export async function DELETE(request: NextRequest) {
    const user = await getCurrentUser()
    if (!user) return Response.json({ error: "Authentication required." }, { status: 401 })
    const currentDeviceId = request.cookies.get(PUSH_DEVICE_COOKIE)?.value
    if (currentDeviceId && UUID_PATTERN.test(currentDeviceId)) {
        const { error } = await supabaseAdmin.from("web_push_subscriptions").delete().eq("user_id", user.id).eq("device_id", currentDeviceId)
        if (error) return Response.json({ error: "Could not disable notifications on this device." }, { status: 503 })
    }
    return Response.json({ subscribed: false })
}
