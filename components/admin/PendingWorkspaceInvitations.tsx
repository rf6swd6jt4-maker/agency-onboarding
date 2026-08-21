import { supabaseAdmin } from "@/lib/supabase/admin"
import { workspaceRoleLabel } from "@/lib/workspaces"
import { WorkspaceActionButton } from "@/components/workspace/WorkspaceActionButton"
import { Status, type StatusTone } from "@/components/ui"

function deliveryStatus(status: string): { label: string; tone: StatusTone } {
    if (status === "delivered") return { label: "Delivered", tone: "green" }
    if (status === "sent" || status === "queued") return { label: status === "sent" ? "Sent" : "Queued", tone: "yellow" }
    if (status === "delayed") return { label: "Delayed", tone: "yellow" }
    if (["failed", "bounced", "suppressed"].includes(status)) return { label: status === "bounced" ? "Bounced" : status === "suppressed" ? "Suppressed" : "Failed", tone: "red" }
    return { label: "Pending", tone: "grey" }
}

export async function PendingWorkspaceInvitations({ workspaceId, removeAction }: { workspaceId: string; removeAction: (invitationId: string) => Promise<void> }) {
    const { data: invitations } = await supabaseAdmin.from("workspace_invitations").select("id, email, role, expires_at, delivery_status").eq("workspace_id", workspaceId).is("accepted_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false })
    if (!invitations?.length) return null
    const users = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    return <>{invitations.map((invite) => { const registered = users.data.users.some((user) => user.email?.toLowerCase() === invite.email.toLowerCase()); const status = deliveryStatus(invite.delivery_status); return <div key={invite.id} className="flex flex-col gap-3 border-b border-neutral-800 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"><div><p className="break-words font-medium">{invite.email}</p><p className="mt-1 text-sm text-neutral-500"><span>{workspaceRoleLabel(invite.role)}</span> <span>— {registered ? "Existing account" : "New account"}</span></p></div><div className="flex items-center gap-3"><Status label={status.label} tone={status.tone} /><form action={removeAction.bind(null, invite.id)} data-workspace-mutation="background"><WorkspaceActionButton pendingLabel="Revoking…" confirmMessage={`Revoke the invitation for ${invite.email}? Its current link will stop working.`} className="rounded-lg border border-red-900 px-3 py-1 text-sm text-red-300 hover:bg-red-950/30">Revoke</WorkspaceActionButton></form></div></div> })}</>
}
