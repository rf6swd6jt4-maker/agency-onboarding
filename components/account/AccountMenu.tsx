"use client"

import Link from "next/link"
import { useEffect, useId, useRef, useState } from "react"
import { LeaveWorkspaceForm } from "@/components/account/LeaveWorkspaceForm"
import { Avatar } from "@/components/account/Avatar"

type Props = { username: string; email: string; avatarSrc?: string | null; workspaceId: string; workspaceName: string; leaveAction: (formData: FormData) => void; buttonClassName?: string }

export function AccountMenu({ username, email, avatarSrc, workspaceId, workspaceName, leaveAction, buttonClassName }: Props) {
    const [open, setOpen] = useState(false)
    const menuId = useId()
    const menuRef = useRef<HTMLDivElement>(null)
    useEffect(() => {
        const close = (event: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false) }
        const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false)
        const closeForOtherDropdown = (event: Event) => { if ((event as CustomEvent<string>).detail !== menuId) setOpen(false) }
        document.addEventListener("mousedown", close); document.addEventListener("keydown", escape); window.addEventListener("betelgeze:dropdown-open", closeForOtherDropdown)
        return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); window.removeEventListener("betelgeze:dropdown-open", closeForOtherDropdown) }
    }, [menuId])
    function toggle() {
        setOpen((value) => {
            const next = !value
            if (next) window.dispatchEvent(new CustomEvent("betelgeze:dropdown-open", { detail: menuId }))
            return next
        })
    }
    return <div ref={menuRef} className="relative shrink-0 self-center">
        <button data-icon-button type="button" onClick={toggle} aria-label="Open account menu" aria-expanded={open} aria-haspopup="menu" className={`inline-flex shrink-0 aspect-square items-center justify-center overflow-hidden rounded-full border border-neutral-600 bg-neutral-900 p-0 hover:border-neutral-400 focus:outline-none focus:ring-2 focus:ring-white/30 ${buttonClassName ?? "h-11 w-11 sm:h-10 sm:w-10"}`}><Avatar src={avatarSrc} name={username} className="h-full w-full" /></button>
        {open && <div role="menu" className="absolute right-0 z-30 mt-2 w-[calc(100vw-2rem)] max-w-64 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl"><div className="flex items-center gap-2.5 border-b border-neutral-800 px-3 py-2.5"><Avatar src={avatarSrc} name={username} className="h-9 w-9 shrink-0" /><div className="min-w-0"><p className="truncate text-sm font-medium text-white">@{username}</p><p className="mt-0.5 truncate text-xs text-neutral-400">{email}</p></div></div><div className="border-b border-neutral-800 px-3 py-2"><p className="text-[11px] text-neutral-500">Current workspace</p><p className="mt-0.5 truncate text-sm font-medium text-white">{workspaceName}</p></div><Link href={`/users/${username}`} role="menuitem" className="block min-h-10 px-3 py-2.5 text-sm text-neutral-200 hover:bg-neutral-800">View profile</Link><form action="/logout" method="post"><button type="submit" role="menuitem" className="block min-h-10 w-full px-3 py-2.5 text-left text-sm text-neutral-200 hover:bg-neutral-800">Log out</button></form><div className="border-t border-neutral-800 p-1.5"><LeaveWorkspaceForm action={leaveAction} workspaceId={workspaceId} className="min-h-10 w-full border-0 px-2 py-2 text-left hover:bg-red-500/10" /></div></div>}
    </div>
}
