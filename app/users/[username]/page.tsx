import Link from "next/link"
import { redirect } from "next/navigation"
import { redirectToLogin } from "@/lib/auth/server-redirects"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { getCurrentUser, workspaceRoleLabel } from "@/lib/workspaces"
import { createUploadSignedUrl } from "@/lib/onboarding/uploads"
import { AccountWelcomeDialog } from "@/components/account/AccountWelcomeDialog"
import { Avatar } from "@/components/account/Avatar"
import { LeaveWorkspaceForm } from "@/components/account/LeaveWorkspaceForm"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { Status } from "@/components/ui"
import { leaveWorkspace } from "./actions"

type PageProps = { params: Promise<{ username: string }> }

export default async function UserAccountPage({ params }: PageProps) {
    const { username } = await params
    const user = await getCurrentUser()
    if (!user?.email) return await redirectToLogin()
    const { data: profile } = await supabaseAdmin.from("user_profiles").select("username, display_name, avatar_path, mfa_reenrollment_required").eq("user_id", user.id).maybeSingle()
    if (!profile) return await redirectToLogin()
    if (profile.username !== username) redirect(`/users/${profile.username}`)

    const [avatarSrc, membershipsResult, invitationsResult, factorResult] = await Promise.all([
        profile.avatar_path ? createUploadSignedUrl(profile.avatar_path) : Promise.resolve(null),
        supabaseAdmin.from("workspace_memberships").select("workspace_id, role, workspaces!workspace_memberships_workspace_id_fkey(name, slug, status)").eq("user_id", user.id),
        supabaseAdmin.from("workspace_invitations").select("id, role, expires_at, delivery_status, workspaces!inner(name, slug)").eq("email", user.email.toLowerCase()).is("accepted_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString()),
        supabaseAdmin.auth.admin.mfa.listFactors({ userId: user.id }),
    ])
    if (membershipsResult.error) throw new Error("Could not load workspace memberships.", { cause: membershipsResult.error })
    const activeMemberships = (membershipsResult.data ?? []).filter((membership) => (membership.workspaces as unknown as { status: string }).status === "active")
    const factors = factorResult.data?.factors.filter((factor) => factor.status === "verified") ?? []

    return <main className="min-h-dvh bg-neutral-950 px-5 py-8 text-white sm:px-8">
        <AccountWelcomeDialog />
        <div className="mx-auto max-w-3xl">
            <div className="flex items-center justify-between gap-4"><Link href="/workspaces" className="text-sm text-neutral-400 hover:text-white">Betelgeze account</Link><form action="/logout" method="post"><button className="min-h-10 rounded-lg border border-neutral-700 px-3 py-2 text-sm hover:border-neutral-500">Log out</button></form></div>
            <section className="mt-8 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900">
                <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center">
                    <Avatar src={avatarSrc} name={profile.display_name} className="h-24 w-24 border-2 border-neutral-700" />
                    <div className="min-w-0 flex-1"><h1 className="truncate text-3xl font-semibold">{profile.display_name}</h1><p className="mt-1 text-sm text-neutral-500">@{profile.username}</p><p className="mt-2 truncate text-sm text-neutral-300">{user.email}</p><div className="mt-3 flex flex-wrap gap-x-5 gap-y-2"><Status label="Email verified" tone="green" /><Status label={profile.mfa_reenrollment_required ? "Authenticator setup required" : factors.length ? "Primary authenticator verified" : "Authenticator missing"} tone={profile.mfa_reenrollment_required || !factors.length ? "red" : "green"} />{!profile.mfa_reenrollment_required && factors.length ? <Status label={factors.length > 1 ? "Backup authenticator verified" : "Backup authenticator optional"} tone={factors.length > 1 ? "green" : "grey"} /> : null}</div></div>
                    <div className="flex shrink-0 gap-2 sm:flex-col"><Link href={`/users/${profile.username}/edit`} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-neutral-700 px-3 py-2 text-sm hover:border-neutral-500">Edit profile</Link><Link href={`/users/${profile.username}/security`} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-neutral-700 px-3 py-2 text-sm hover:border-neutral-500">Security</Link></div>
                </div>
            </section>

            {(invitationsResult.data ?? []).length > 0 ? <section className="mt-10"><h2 className="text-xl font-semibold">Workspace invitations</h2><p className="mt-2 text-sm text-neutral-400">Open the newest invitation email to accept through the secured account flow.</p><List ariaLabel="Workspace invitations">{(invitationsResult.data ?? []).map((invite) => { const workspace = invite.workspaces as unknown as { name: string; slug: string }; return <ListItem key={invite.id}><ListPrimaryRow><ListTitle>{workspace.name}</ListTitle><Status label="Awaiting acceptance" tone="yellow" /></ListPrimaryRow><ListSecondaryRow><span className="text-neutral-400">Invited as {workspaceRoleLabel(invite.role)}</span><ListTrailing><span className="text-xs text-neutral-500">Expires {new Date(invite.expires_at).toLocaleDateString()}</span></ListTrailing></ListSecondaryRow></ListItem> })}</List></section> : null}

            <section className="mt-10"><div className="flex items-center justify-between gap-4"><div><h2 className="text-xl font-semibold">Your workspaces</h2><p className="mt-2 text-sm text-neutral-400">Workspaces you can open with this secured account.</p></div><Link href={`/users/${profile.username}/create-dashboard`} className="text-sm text-neutral-300 underline underline-offset-4">Create workspace</Link></div>
                {activeMemberships.length ? <List ariaLabel="Your workspaces">{activeMemberships.map((membership) => { const workspace = membership.workspaces as unknown as { name: string; slug: string }; return <ListItem key={membership.workspace_id}><ListPrimaryRow><ListTitle href={`/${workspace.slug}`}>{workspace.name}</ListTitle><Status label="Active" tone="green" /></ListPrimaryRow><ListSecondaryRow><span className="text-neutral-400">{workspaceRoleLabel(membership.role)}</span><ListTrailing><LeaveWorkspaceForm workspaceId={membership.workspace_id} action={leaveWorkspace.bind(null, profile.username)} /></ListTrailing></ListSecondaryRow></ListItem> })}</List> : <div className="mt-5 rounded-2xl border border-neutral-800 bg-neutral-900 p-5"><Status label="No active workspaces" tone="grey" /></div>}
            </section>
        </div>
    </main>
}
