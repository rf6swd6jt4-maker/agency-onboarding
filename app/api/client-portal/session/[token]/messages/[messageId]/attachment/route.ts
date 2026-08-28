import { loadClientPortalAttachmentAccess } from "@/lib/client-portal/messages"
import { resolveClientPortalAccessByToken } from "@/lib/client-portal/session"
import { createEncryptedPrivateUploadSignedRequest, createPrivateUploadSignedUrl } from "@/lib/onboarding/uploads"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type RouteContext = {
    params: Promise<{ token: string; messageId: string }>
}

function safeFileName(value: string) {
    return value.replace(/["\\\r\n]/g, "").slice(0, 180) || "attachment"
}

async function loadAttachment(request: Request, context: RouteContext) {
    const { token, messageId } = await context.params
    if (!UUID_PATTERN.test(messageId)) return { error: new Response("Attachment not found", { status: 404 }) }
    const resolved = await resolveClientPortalAccessByToken(token)
    if (!resolved) return { error: new Response("Attachment not found", { status: 404 }) }

    const access = await loadClientPortalAttachmentAccess({
        workspaceId: resolved.workspace.id,
        relationshipId: resolved.relationship.id,
        messageId,
    }).catch(() => null)
    if (!access || (access.isEncrypted && !access.customerKey)) {
        return { error: new Response("Attachment not found", { status: 404 }) }
    }

    try {
        const signed = access.customerKey
            ? await createEncryptedPrivateUploadSignedRequest(access.storagePath, access.customerKey)
            : { url: await createPrivateUploadSignedUrl(access.storagePath), headers: {} as Record<string, string> }
        const range = request.headers.get("range")
        const upstream = await fetch(signed.url, {
            headers: { ...signed.headers, ...(range ? { Range: range } : {}) },
        })
        if (!upstream.ok) return { error: new Response("Attachment not found", { status: upstream.status }) }

        const headers = new Headers({
            "Accept-Ranges": upstream.headers.get("accept-ranges") ?? "bytes",
            "Cache-Control": "private, max-age=300",
            "Content-Disposition": `inline; filename="${safeFileName(access.fileName)}"`,
            "Content-Type": upstream.headers.get("content-type") ?? access.mimeType,
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
        })
        for (const header of ["content-length", "content-range", "etag", "last-modified"] as const) {
            const value = upstream.headers.get(header)
            if (value) headers.set(header, value)
        }
        return { upstream, headers }
    } catch {
        return { error: new Response("Attachment is temporarily unavailable", { status: 503 }) }
    }
}

export async function GET(request: Request, context: RouteContext) {
    const result = await loadAttachment(request, context)
    if ("error" in result) return result.error
    return new Response(result.upstream.body, { status: result.upstream.status, headers: result.headers })
}

export async function HEAD(request: Request, context: RouteContext) {
    const result = await loadAttachment(request, context)
    if ("error" in result) return result.error
    return new Response(null, { status: result.upstream.status, headers: result.headers })
}
