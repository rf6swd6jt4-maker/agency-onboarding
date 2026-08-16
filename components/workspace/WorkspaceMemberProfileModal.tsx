"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Avatar } from "@/components/account/Avatar"
import { Status } from "@/components/ui"
import { formatRelativeTime } from "@/lib/ui/relative-time"

type Profile = {
    id: string
    displayName: string
    username: string | null
    email: string
    avatarSrc: string | null
    lastSeenAt: string | null
    isSelf: boolean
    sharedWorkspaces: Array<{ name: string; slug: string; current: boolean }>
}

export function WorkspaceMemberProfileModal({ workspaceSlug, userId, initialProfile, active, onClose, onMessage }: {
    workspaceSlug: string
    userId: string
    initialProfile?: { displayName: string; avatarSrc: string | null } | null
    active: boolean
    onClose: () => void
    onMessage: (userId: string) => void
}) {
    const [profile, setProfile] = useState<Profile | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        const controller = new AbortController()
        void fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/members/${encodeURIComponent(userId)}/profile`, { signal: controller.signal })
            .then(async (response) => {
                const result = await response.json().catch(() => null) as { profile?: Profile; error?: string } | null
                if (!response.ok || !result?.profile) throw new Error(result?.error ?? "Could not load this profile.")
                setProfile(result.profile)
            })
            .catch((fetchError) => { if (!controller.signal.aborted) setError(fetchError instanceof Error ? fetchError.message : "Could not load this profile.") })
        return () => controller.abort()
    }, [userId, workspaceSlug])

    useEffect(() => {
        const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose() }
        window.addEventListener("keydown", close)
        return () => window.removeEventListener("keydown", close)
    }, [onClose])

    return <div role="dialog" aria-modal="true" aria-labelledby="workspace-member-profile-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }} className="fixed inset-0 z-[180] flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm">
        <div className="w-full max-w-md overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-950 text-white shadow-2xl shadow-black/60">
            <div className="flex justify-end px-4 pt-4"><button type="button" onClick={onClose} aria-label="Close profile" className="inline-flex h-9 w-9 items-center justify-center rounded-full text-xl text-neutral-500 hover:bg-neutral-900 hover:text-white">×</button></div>
            {error ? <div className="px-6 pb-8 text-center"><p className="text-sm text-red-300">{error}</p></div> : !profile && initialProfile ? <section className="flex flex-col items-center px-6 pb-10 text-center">
                <Avatar src={initialProfile.avatarSrc} name={initialProfile.displayName} className="h-28 w-28 border-2 border-neutral-700" />
                <h2 id="workspace-member-profile-title" className="mt-5 max-w-full break-words text-4xl font-bold tracking-tight">{initialProfile.displayName}</h2>
                <Status label={active ? "Online" : "Last seen - loading…"} tone={active ? "green" : "grey"} className="mt-4" />
            </section> : !profile ? <div className="px-6 pb-10 text-center text-sm text-neutral-500">Loading profile…</div> : <>
                <section className="flex flex-col items-center px-6 pb-6 text-center">
                    <Avatar src={profile.avatarSrc} name={profile.displayName} className="h-28 w-28 border-2 border-neutral-700" />
                    <h2 id="workspace-member-profile-title" className="mt-5 max-w-full break-words text-4xl font-bold tracking-tight">{profile.displayName}</h2>
                    {profile.isSelf && profile.username ? <p className="mt-2 text-sm text-neutral-500">@{profile.username}</p> : null}
                    <p className="mt-2 max-w-full break-all text-sm text-neutral-300">{profile.email}</p>
                    <Status label={active ? "Online" : profile.lastSeenAt ? `Last seen - ${formatRelativeTime(profile.lastSeenAt)}` : "Last seen - unavailable"} tone={active ? "green" : "grey"} className="mt-4" />
                    {profile.isSelf ? <Link href={`/users/${profile.username}/edit`} className="mt-5 inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-black">Edit profile</Link> : <button type="button" onClick={() => onMessage(profile.id)} className="mt-5 inline-flex h-10 items-center justify-center rounded-lg bg-white px-5 text-sm font-semibold text-black">Message</button>}
                </section>
                <section className="border-t border-neutral-800 px-5 py-5">
                    <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">Shared workspaces</h3>
                    <div className="mt-3 space-y-1">{profile.sharedWorkspaces.map((shared) => shared.current ? <div key={shared.slug} className="flex min-h-10 items-center justify-between rounded-lg bg-neutral-900 px-3 text-sm"><span>{shared.name}</span><span className="text-[10px] uppercase tracking-wide text-emerald-400">Current</span></div> : <a key={shared.slug} href={`/${shared.slug}`} className="flex min-h-10 items-center justify-between rounded-lg px-3 text-sm text-neutral-300 hover:bg-neutral-900 hover:text-white"><span>{shared.name}</span><span aria-hidden="true">→</span></a>)}</div>
                </section>
            </>}
        </div>
    </div>
}
