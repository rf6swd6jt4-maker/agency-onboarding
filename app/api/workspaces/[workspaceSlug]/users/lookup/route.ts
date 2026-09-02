import { USERNAME_PATTERN } from "@/lib/auth/username"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type LookupRow = {
    input_kind?: unknown
    account_exists?: unknown
    email?: unknown
    username?: unknown
    is_workspace_member?: unknown
    invitation_pending?: unknown
}

export async function GET(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    const rawIdentifier = new URL(request.url).searchParams.get("identifier")?.trim().toLowerCase() ?? ""
    const username = rawIdentifier.replace(/^@/, "")
    const isEmail = rawIdentifier.includes("@") && !rawIdentifier.startsWith("@")
    const valid = isEmail
        ? rawIdentifier.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawIdentifier)
        : USERNAME_PATTERN.test(username)
    if (!valid) return Response.json({ error: isEmail ? "Enter a valid email address." : "Enter an exact username or email address." }, { status: 400, headers: { "Cache-Control": "no-store" } })

    const { data, error } = await supabaseAdmin.rpc("lookup_workspace_invitation_target", {
        p_workspace_id: workspace.id,
        p_actor_user_id: user.id,
        p_identifier: rawIdentifier,
    })
    if (error || !data) return Response.json({ error: "Betelgeze could not check that account right now." }, { status: 503, headers: { "Cache-Control": "no-store" } })

    const result = data as LookupRow
    const accountExists = result.account_exists === true
    const email = typeof result.email === "string" ? result.email : null
    const resolvedUsername = typeof result.username === "string" ? result.username : null
    const isWorkspaceMember = result.is_workspace_member === true
    const invitationPending = result.invitation_pending === true
    const status = isWorkspaceMember
        ? "already_member"
        : invitationPending
            ? accountExists ? "workspace_invite_pending" : "betelgeze_invite_pending"
            : accountExists ? "on_betelgeze" : "not_on_betelgeze"

    return Response.json({
        status,
        accountExists,
        email,
        username: resolvedUsername,
        canInvite: !isWorkspaceMember && !invitationPending && Boolean(email),
        actionLabel: accountExists ? "Invite to workspace" : "Invite to Betelgeze",
    }, { headers: { "Cache-Control": "no-store" } })
}
