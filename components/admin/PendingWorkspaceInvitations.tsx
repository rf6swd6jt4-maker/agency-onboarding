import { supabaseAdmin } from "@/lib/supabase/admin"
import { workspaceRoleLabel } from "@/lib/workspaces"
import { WorkspaceActionButton } from "@/components/workspace/WorkspaceActionButton"

export async function PendingWorkspaceInvitations({ workspaceId, removeAction }: { workspaceId: string; removeAction: (invitationId: string) => Promise<void> }) {
    const { data: invitations } = await supabaseAdmin.from("workspace_invitations").select("id, email, role, expires_at").eq("workspace_id", workspaceId).is("accepted_at", null).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false })
    if (!invitations?.length) return null
    const users = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    return <>{invitations.map((invite) => { const registered = users.data.users.some((user) => user.email?.toLowerCase() === invite.email.toLowerCase()); return <div key={invite.id} className="flex flex-col gap-3 border-b border-neutral-800 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"><div><p className="break-words font-medium">{invite.email}</p><p className="mt-1 text-sm text-neutral-500"><span>{workspaceRoleLabel(invite.role)}</span> <span className="text-amber-300">— {registered ? "Invite pending" : "Not on Betelgeze yet"}</span></p></div><div className="flex items-center gap-2"><span className="rounded-full border border-amber-300/20 px-3 py-1 text-xs text-amber-100">Pending</span><form action={removeAction.bind(null, invite.id)} data-workspace-mutation="background"><WorkspaceActionButton pendingLabel="Removing…" confirmMessage={`Remove the invitation for ${invite.email}?`} className="rounded-lg border border-red-900 px-3 py-1 text-sm text-red-300 hover:bg-red-950/30">Remove</WorkspaceActionButton></form></div></div> })}</>
}
