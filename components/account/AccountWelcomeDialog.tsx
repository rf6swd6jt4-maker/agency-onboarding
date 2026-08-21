"use client"

import { useEffect, useRef, useState } from "react"
import { Status } from "@/components/ui"

type WelcomeEvent = { workspaceName: string; workspaceSlug: string; role: string }

export function AccountWelcomeDialog() {
    const [event, setEvent] = useState<WelcomeEvent | null>(null)
    const close = useRef<HTMLButtonElement>(null)
    const dialog = useRef<HTMLElement>(null)
    useEffect(() => {
        void fetch("/api/account/welcome", { method: "POST" })
            .then((response) => response.json())
            .then((body: { event?: WelcomeEvent | null }) => { if (body.event) setEvent(body.event) })
            .catch(() => undefined)
    }, [])
    useEffect(() => {
        if (!event) return
        const previous = document.activeElement as HTMLElement | null
        close.current?.focus()
        const handleKeyboard = (keyboardEvent: KeyboardEvent) => {
            if (keyboardEvent.key === "Escape") { setEvent(null); return }
            if (keyboardEvent.key !== "Tab") return
            const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button, a[href]") ?? [])
            const first = focusable[0]
            const last = focusable.at(-1)
            if (keyboardEvent.shiftKey && document.activeElement === first) { keyboardEvent.preventDefault(); last?.focus() }
            else if (!keyboardEvent.shiftKey && document.activeElement === last) { keyboardEvent.preventDefault(); first?.focus() }
        }
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = "hidden"
        document.addEventListener("keydown", handleKeyboard)
        return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", handleKeyboard); previous?.focus() }
    }, [event])
    if (!event) return null
    const role = event.role === "admin" ? "Administrator" : event.role === "owner" ? "Owner" : "Staff"
    return <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/75 px-5" role="presentation" onMouseDown={(mouseEvent) => { if (mouseEvent.target === mouseEvent.currentTarget) setEvent(null) }}>
        <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="welcome-title" aria-describedby="welcome-description" className="w-full max-w-md rounded-2xl border border-neutral-700 bg-neutral-900 p-6 text-white shadow-2xl">
            <Status label="Invitation accepted" tone="green" />
            <h2 id="welcome-title" className="mt-5 text-2xl font-semibold">You joined {event.workspaceName}</h2>
            <p id="welcome-description" className="mt-3 text-sm leading-6 text-neutral-300">Your account is secured and you now have {role} access. You can open the workspace now or finish looking around your profile.</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <button ref={close} type="button" onClick={() => setEvent(null)} className="min-h-11 rounded-lg border border-neutral-700 px-4 py-3 text-sm font-medium hover:border-neutral-500">Stay on profile</button>
                <a href={`/${event.workspaceSlug}`} className="flex min-h-11 items-center justify-center rounded-lg bg-white px-4 py-3 text-sm font-semibold text-black hover:bg-neutral-200">Open workspace</a>
            </div>
        </section>
    </div>
}
