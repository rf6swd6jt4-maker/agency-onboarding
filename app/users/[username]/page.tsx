import Link from "next/link"
import { redirect } from "next/navigation"
import { redirectToLogin } from "@/lib/auth/server-redirects"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { getCurrentUser, workspaceRoleLabel } from "@/lib/workspaces"
import { createUploadSignedUrl } from "@/lib/onboarding/uploads"
import { Avatar } from "@/components/account/Avatar"
import { LeaveWorkspaceForm } from "@/components/account/LeaveWorkspaceForm"
import { acceptWorkspaceInvitation, leaveWorkspace } from "./actions"

type PageProps = { params: Promise<{ username: string }> }

export default async function UserAccountPage({ params }: PageProps) {
    const { username } = await params
    const user = await getCurrentUser()
    if (!user?.email) return await redirectToLogin()

    const { data: profile } = await supabaseAdmin
        .from("user_profiles")
        .select("username, avatar_path")
        .eq("user_id", user.id)
        .maybeSingle()

    if (!profile) return await redirectToLogin()
    if (profile.username !== username) redirect(`/users/${profile.username}`)

    const avatarSrc = profile.avatar_path
        ? await createUploadSignedUrl(profile.avatar_path)
        : null
    const [{ data: memberships }, { data: invitations }] = await Promise.all([
        supabaseAdmin
            .from("workspace_memberships")
            .select("workspace_id, role, workspaces!inner(name, slug, status)")
            .eq("user_id", user.id),
        supabaseAdmin
            .from("workspace_invitations")
            .select("id, role, expires_at, workspaces!inner(name, slug)")
            .eq("email", user.email.toLowerCase())
            .is("accepted_at", null)
            .gt("expires_at", new Date().toISOString()),
    ])

    const activeMemberships = (memberships ?? []).filter(
        (membership) =>
            (membership.workspaces as unknown as { status: string }).status ===
            "active"
    )

    return (
        <main className="min-h-screen bg-neutral-950 px-5 py-8 text-white sm:px-8">
            <div className="mx-auto max-w-3xl">
                <div className="flex justify-end">
                    <form action="/logout" method="post">
                        <button className="rounded-lg border border-neutral-700 px-3 py-2 text-sm hover:border-neutral-500">Log out</button>
                    </form>
                </div>

                <section className="mt-2 flex flex-col items-center text-center">
                    <Avatar src={avatarSrc} name={profile.username} className="h-24 w-24 border-2 border-neutral-700" />
                    <h1 className="mt-4 text-3xl font-semibold">@{profile.username}</h1>
                    <p className="mt-2 text-sm text-neutral-400">{user.email}</p>
                    <Link href={`/users/${profile.username}/edit`} className="mt-5 rounded-lg border border-neutral-600 px-4 py-2 text-sm font-medium hover:border-neutral-400">
                        Edit profile
                    </Link>
                </section>

                {(invitations ?? []).length > 0 && (
                    <section className="mt-10">
                        <h2 className="text-xl font-semibold">Workspace invitations</h2>
                        <div className="mt-4 space-y-3">
                            {(invitations ?? []).map((invite) => {
                                const workspace = invite.workspaces as unknown as { name: string; slug: string }
                                return (
                                    <div key={invite.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-blue-400/30 bg-blue-500/10 p-5">
                                        <div>
                                            <p className="font-medium">{workspace.name}</p>
                                            <p className="mt-1 text-sm text-neutral-300">Invited as {workspaceRoleLabel(invite.role)}</p>
                                        </div>
                                        <form action={acceptWorkspaceInvitation.bind(null, profile.username)}>
                                            <input type="hidden" name="token" value={invite.id} />
                                            <button className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black">Accept invite</button>
                                        </form>
                                    </div>
                                )
                            })}
                        </div>
                    </section>
                )}

                <section className="mt-10">
                    <div className="flex items-center justify-between gap-4">
                        <h2 className="text-xl font-semibold">Your workspaces</h2>
                        <Link href={`/users/${profile.username}/create-dashboard`} className="text-sm text-neutral-300 underline underline-offset-4">
                            Create new workspace
                        </Link>
                    </div>
                    <div className="mt-4 space-y-3">
                        {activeMemberships.map((membership) => {
                            const workspace = membership.workspaces as unknown as { name: string; slug: string }
                            return (
                                <div key={membership.workspace_id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
                                    <div>
                                        <Link href={`/${workspace.slug}`} className="font-medium hover:underline">{workspace.name}</Link>
                                        <p className="mt-1 text-sm text-neutral-500">{workspaceRoleLabel(membership.role)}</p>
                                    </div>
                                    <LeaveWorkspaceForm workspaceId={membership.workspace_id} action={leaveWorkspace.bind(null, profile.username)} />
                                </div>
                            )
                        })}
                    </div>
                    {activeMemberships.length === 0 && <p className="mt-4 text-sm text-neutral-400">You have no workspaces yet.</p>}
                </section>
            </div>
        </main>
    )
}
