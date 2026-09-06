"use client"

import { useEffect, useRef, useState } from "react"
import { SquarePill } from "@/components/ui/SquarePill"
import { displayMessageAddress } from "@/lib/client-messages/addresses"

type ProfileMenuProps = {
    name: string | null
    email: string | null
    phone: string | null
    isTest?: boolean
}

export function ProfileMenu({ name, email, phone, isTest = false }: ProfileMenuProps) {
    const [open, setOpen] = useState(false)
    const menuRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        function handlePointerDown(event: MouseEvent) {
            if (
                menuRef.current &&
                !menuRef.current.contains(event.target as Node)
            ) {
                setOpen(false)
            }
        }

        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") {
                setOpen(false)
            }
        }

        document.addEventListener("mousedown", handlePointerDown)
        document.addEventListener("keydown", handleKeyDown)

        return () => {
            document.removeEventListener("mousedown", handlePointerDown)
            document.removeEventListener("keydown", handleKeyDown)
        }
    }, [])

    const displayName = name?.trim() || "Client"
    const initials = displayName
        .split(/\s+/)
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()

    return (
        <div ref={menuRef} className="relative">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-black/10 bg-[var(--onboarding-page,#F8F7F3)] text-sm font-semibold text-[var(--onboarding-primary,#1E3A5F)] transition hover:border-[var(--onboarding-primary,#1E3A5F)] focus:outline-none focus:ring-4 focus:ring-black/5 sm:h-10 sm:w-10"
                aria-label="Show client profile"
                aria-expanded={open}
                aria-haspopup="dialog"
            >
                {initials}
            </button>

            {open && (
                <div className="betelgeze-popup-enter absolute right-0 top-12 z-40 w-[min(18rem,calc(100vw-1.5rem))] rounded-2xl border border-black/10 bg-[var(--onboarding-surface,#FFFFFF)] p-4 text-left shadow-xl">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--onboarding-muted,#475569)]">
                        Client profile
                    </p>
                    <p className="mt-2 font-semibold text-[var(--onboarding-text,#0F172A)]">
                        {displayName}
                    </p>
                    {isTest && (
                        <SquarePill tone="yellow" className="mt-2">Test</SquarePill>
                    )}
                    <p className="mt-1 break-all text-sm text-[var(--onboarding-muted,#475569)]">
                        {phone ? displayMessageAddress(phone) : "No phone saved"}
                    </p>
                    {email && (
                        <p className="mt-1 break-all text-xs text-[var(--onboarding-muted,#475569)]">
                            {email}
                        </p>
                    )}
                </div>
            )}
        </div>
    )
}
