"use client"

import { useEffect, useId, useRef, useState } from "react"
import Link from "next/link"

export function AdminActionsMenu({ workspaceSlug }: { workspaceSlug?: string }) {
    const [open, setOpen] = useState(false)
    const menuId = useId()
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
        function handleOtherDropdown(event: Event) {
            if ((event as CustomEvent<string>).detail !== menuId) setOpen(false)
        }

        document.addEventListener("mousedown", handlePointerDown)
        document.addEventListener("keydown", handleKeyDown)
        window.addEventListener("betelgeze:dropdown-open", handleOtherDropdown)

        return () => {
            document.removeEventListener("mousedown", handlePointerDown)
            document.removeEventListener("keydown", handleKeyDown)
            window.removeEventListener("betelgeze:dropdown-open", handleOtherDropdown)
        }
    }, [menuId])

    function toggle() {
        setOpen((value) => {
            const next = !value
            if (next) window.dispatchEvent(new CustomEvent("betelgeze:dropdown-open", { detail: menuId }))
            return next
        })
    }

    return (
        <div ref={menuRef} className="relative z-50">
            <button
                type="button"
                onClick={toggle}
                className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-neutral-700 text-white hover:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-white/30 sm:h-10 sm:w-10"
                aria-label="Open operational actions"
                aria-expanded={open}
                aria-haspopup="menu"
            >
                <span aria-hidden="true" className="flex items-center gap-0.5">
                    <span className="h-1 w-1 rounded-full bg-current" />
                    <span className="h-1 w-1 rounded-full bg-current" />
                    <span className="h-1 w-1 rounded-full bg-current" />
                </span>
            </button>

            {open && (
                <div
                    className="betelgeze-popup-enter absolute right-0 z-[9999] mt-2 w-[calc(100vw-2rem)] max-w-60 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 shadow-xl"
                    role="menu"
                >
                    <Link
                        href={workspaceSlug ? `/${workspaceSlug}/relationships?create=relationship` : "/relationships"}
                        className="block min-h-10 px-3 py-2.5 text-sm text-neutral-200 hover:bg-neutral-800"
                        role="menuitem"
                    >
                        Start new relationship
                    </Link>
                </div>
            )}
        </div>
    )
}
