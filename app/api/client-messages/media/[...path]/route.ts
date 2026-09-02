import { createEncryptedPrivateUploadSignedRequest, createPrivateUploadSignedUrl } from "@/lib/onboarding/uploads"
import { assertNativeConversationAccess } from "@/lib/teams/server"
import { getCurrentUser } from "@/lib/workspaces"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { communicationFileKeyForCurrentUser, redeemCommunicationMediaGrant } from "@/lib/communications/encryption"
import { normalizeWorkspaceRole } from "@/lib/workspace-roles"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = {
    params: Promise<{
        path?: string[]
    }>
}

async function loadMediaResponse(request: Request, context: RouteContext) {
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
        const signed = customerKey
            ? await createEncryptedPrivateUploadSignedRequest(storagePath, customerKey)
            : { url: await createPrivateUploadSignedUrl(storagePath), headers: {} as Record<string, string> }
        const range = request.headers.get("range")
        const mediaResponse = await fetch(signed.url, {
            headers: { ...signed.headers, ...(range ? { Range: range } : {}) },
        })

        if (!mediaResponse.ok) {
            return {
                error: new Response("Media not found", {
                    status: mediaResponse.status,
                }),
            }
        }

        return {
            mediaResponse,
            headers: getMediaHeaders(mediaResponse, storagePath),
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

function getMediaHeaders(mediaResponse: Response, storagePath: string) {
    const headers = new Headers({
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `inline; filename="${getSafeFileName(storagePath)}"`,
        "Content-Type":
            mediaResponse.headers.get("content-type") ??
            "application/octet-stream",
        "Accept-Ranges": mediaResponse.headers.get("accept-ranges") ?? "bytes",
        "X-Content-Type-Options": "nosniff",
    })
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

    return new Response(result.mediaResponse.body, {
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
