import Link from "next/link"
import { redirect } from "next/navigation"
import { redirectToLogin } from "@/lib/auth/server-redirects"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { getCurrentUser } from "@/lib/workspaces"
import { createUploadSignedUrl } from "@/lib/onboarding/uploads"
import { DeleteAccountForm } from "@/components/account/DeleteAccountForm"
import { ProfileAvatarEditor } from "@/components/account/ProfileAvatarEditor"
import { ProfileSettings } from "@/components/account/ProfileSettings"
import { deleteAccount, updateProfile, uploadProfileAvatar } from "../actions"

export default async function EditProfile({ params }: { params: Promise<{ username: string }> }) {
    const { username } = await params
    const user = await getCurrentUser()
    if (!user) return await redirectToLogin()
    const { data: profile } = await supabaseAdmin.from("user_profiles").select("username, display_name, avatar_path").eq("user_id", user.id).maybeSingle()
    if (!profile || profile.username !== username) redirect(`/users/${profile?.username ?? ""}`)
    const avatarSrc = profile.avatar_path ? await createUploadSignedUrl(profile.avatar_path) : null

    return <main className="min-h-screen bg-neutral-950 px-5 py-8 text-white"><div className="mx-auto max-w-2xl"><Link href={`/users/${username}`} className="text-sm text-neutral-400">← Back to profile</Link><h1 className="mt-6 text-3xl font-semibold">Edit profile</h1><section className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900 p-5"><ProfileAvatarEditor name={profile.display_name} src={avatarSrc} action={uploadProfileAvatar.bind(null, username)} /><ProfileSettings username={profile.username} displayName={profile.display_name} email={user.email ?? "your email"} action={updateProfile} /></section><section className="mt-6 rounded-xl border border-red-900/50 bg-red-950/20 p-5"><h2 className="font-semibold text-red-200">Delete account</h2><p className="mt-2 text-sm text-red-100/70">This permanently removes your Auth account, profile, and workspace memberships. It does not delete Stripe records.</p><DeleteAccountForm action={deleteAccount} /></section></div></main>
}
