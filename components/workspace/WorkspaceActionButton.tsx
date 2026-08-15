"use client"

import { useFormStatus } from "react-dom"
import type { ButtonHTMLAttributes, ReactNode } from "react"

export function WorkspaceActionButton({
    children,
    pendingLabel = "Working…",
    className,
    disabled,
    confirmMessage,
    onClick,
    ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; pendingLabel?: string; confirmMessage?: string }) {
    const { pending } = useFormStatus()
    return <button {...props} onClick={(event) => {
        if (confirmMessage && !window.confirm(confirmMessage)) {
            event.preventDefault()
            return
        }
        onClick?.(event)
    }} disabled={disabled || pending} className={`${className ?? ""} disabled:cursor-wait disabled:opacity-60`}>
        {pending ? pendingLabel : children}
    </button>
}
