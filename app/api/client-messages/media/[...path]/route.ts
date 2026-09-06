import { createEncryptedPrivateUploadSignedRequest, createPrivateUploadSignedUrl, ensureCommunicationImagePreview } from "@/lib/onboarding/uploads"
import { COMMUNICATION_PREVIEW_SUFFIX } from "@/lib/communications/attachments"
import { communicationMediaRequestHeaders, communicationMediaStatusIsValid } from "@/lib/communications/media-http"
import { assertNativeConversationAccess } from "@/lib/teams/server"
import { getCurrentUser } from "@/lib/workspaces"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { communicationFileKeyForCurrentUser, redeemCommunicationMediaGrant } from "@/lib/communications/encryption"
import { normalizeWorkspaceRole } from "@/lib/workspace-roles"
import { nativeAttachmentDeliveryHeaders } from "@/lib/communications/native-attachments"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = {
    params: Promise<{
        path?: string[]
    }>
}

async function loadMediaResponse(request: Request, context: RouteContext) {
    const started = performance.now()
    const { path = [] } = await context.params
    const storagePath = path.join("/")

    if (!storagePath) {
        return {
            error: new Response("Missing media path", { status: 400 }),
        }
    }

    const grant = new URL(request.url).searchParams.get("grant")
    const workspaceId = path[0] ?? ""
    if (!workspaceId) return { error: new Response("Media not found", { status: 404 }) }
    let customerKey: string | null = null
    if (grant) {
        customerKey = await redeemCommunicationMediaGrant(storagePath, grant).catch(() => null)
        if (!customerKey) return { error: new Response("Media grant expired", { status: 404 }) }
    } else {
        const user = await getCurrentUser()
        if (!user) return { error: new Response("Unauthorized", { status: 401 }) }
        const { data: membership } = await supabaseAdmin
            .from("workspace_memberships")
            .select("user_id, role")
            .eq("workspace_id", workspaceId)
            .eq("user_id", user.id)
            .maybeSingle()
        if (!membership || normalizeWorkspaceRole(membership.role) === "staff") return { error: new Response("Media not found", { status: 404 }) }
        if (path[1] === "communications" && path[2] === "native") {
            const conversationId = path[3] ?? ""
            if (!await assertNativeConversationAccess(conversationId, user.id, "read")) return { error: new Response("Media not found", { status: 404 }) }
        }
        customerKey = await communicationFileKeyForCurrentUser(storagePath)
    }

    try {
        const authorized = performance.now()
        const method = request.method === "HEAD" ? "HEAD" : "GET"
        const preview = new URL(request.url).searchParams.get("preview") === "1"
        // Always authorize the original path. Never expose keys or public URLs.
        const hasPreview = preview && (method === "HEAD" || await ensureCommunicationImagePreview(storagePath, customerKey).catch(() => false))
        const deliveryPath = hasPreview ? `${storagePath}${COMMUNICATION_PREVIEW_SUFFIX}` : storagePath
        const signed = customerKey
            ? await createEncryptedPrivateUploadSignedRequest(deliveryPath, customerKey, undefined, method)
            : { url: await createPrivateUploadSignedUrl(deliveryPath, undefined, method), headers: {} as Record<string, string> }
        const mediaResponse = await fetch(signed.url, {
            method,
            cache: "no-store",
            headers: { ...signed.headers, ...communicationMediaRequestHeaders(request, preview) },
        })

        if (!communicationMediaStatusIsValid(mediaResponse.status)) {
            return {
                error: new Response("Media not found", {
                    status: mediaResponse.status,
                }),
            }
        }

        const headers = getMediaHeaders(mediaResponse, deliveryPath, new URL(request.url).searchParams.get("download"))
        headers.set("Server-Timing", `auth;dur=${(authorized - started).toFixed(1)}, storage;dur=${(performance.now() - authorized).toFixed(1)}`)
        return {
            mediaResponse,
            headers,
            status: mediaResponse.status,
        }
    } catch (error) {
        return {
            error: new Response(
                error instanceof Error ? error.message : "Could not load media",
                { status: 500 }
            ),
        }
    }
}

function getSafeFileName(path: string) {
    const fileName = path.split("/").pop() ?? "whatsapp-media"

    return fileName.replace(/["\\]/g, "")
}

function getMediaHeaders(mediaResponse: Response, storagePath: string, downloadName: string | null) {
    if (mediaResponse.status === 304) {
        // A validator-only reply must not replace the cached representation's
        // real MIME type or length with defaults from an empty upstream response.
        const headers = new Headers({ "Cache-Control": "private, max-age=3600" })
        for (const name of ["etag", "last-modified", "vary"]) {
            const value = mediaResponse.headers.get(name)
            if (value) headers.set(name, value)
        }
        return headers
    }
    const headers = new Headers({
        "Cache-Control": mediaResponse.status === 416 ? "no-store" : "private, max-age=3600",
        "Content-Disposition": `inline; filename="${getSafeFileName(storagePath)}"`,
        "Content-Type":
            mediaResponse.headers.get("content-type") ??
            "application/octet-stream",
        "Accept-Ranges": mediaResponse.headers.get("accept-ranges") ?? "bytes",
        "X-Content-Type-Options": "nosniff",
    })
    if (downloadName !== null || storagePath.split("/").slice(1, 3).join("/") === "communications/native") {
        const deliveryHeaders = nativeAttachmentDeliveryHeaders(
            mediaResponse.headers.get("content-type") ?? "application/octet-stream",
            downloadName || getSafeFileName(storagePath),
            downloadName !== null,
        )
        for (const [name, value] of Object.entries(deliveryHeaders)) headers.set(name, value)
    }
    const contentLength = mediaResponse.headers.get("content-length")
    const contentRange = mediaResponse.headers.get("content-range")
    const etag = mediaResponse.headers.get("etag")
    const lastModified = mediaResponse.headers.get("last-modified")

    if (contentLength) headers.set("Content-Length", contentLength)
    if (contentRange) headers.set("Content-Range", contentRange)
    if (etag) headers.set("ETag", etag)
    if (lastModified) headers.set("Last-Modified", lastModified)

    return headers
}

export async function GET(_request: Request, context: RouteContext) {
    const result = await loadMediaResponse(_request, context)

    if (result.error) return result.error

    return new Response(result.status === 304 ? null : result.mediaResponse.body, {
        headers: result.headers,
        status: result.status,
    })
}

export async function HEAD(_request: Request, context: RouteContext) {
    const result = await loadMediaResponse(_request, context)

    if (result.error) return result.error

    return new Response(null, {
        headers: result.headers,
        status: result.status,
    })
}
