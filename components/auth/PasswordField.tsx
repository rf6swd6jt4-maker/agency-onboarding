"use client"

import { useMemo, useState } from "react"
import { AuthFieldFeedback } from "@/components/auth/AuthFieldFeedback"
import { authInput } from "@/components/auth/AuthFlowShell"
import { passwordRequirements } from "@/lib/auth/password"

export function PasswordField({
    value,
    onChange,
    label = "Password",
    name = "password",
    autoComplete = "new-password",
    showRequirements = true,
    disabled = false,
    invalid = false,
}: {
    value: string
    onChange: (value: string) => void
    label?: string
    name?: string
    autoComplete?: "new-password" | "current-password"
    showRequirements?: boolean
    disabled?: boolean
    invalid?: boolean
}) {
    const [visible, setVisible] = useState(false)
    const [capsLock, setCapsLock] = useState(false)
    const requirements = useMemo(() => passwordRequirements(value), [value])
    return (
        <div>
            <div className="flex items-center justify-between gap-4">
                <label htmlFor={name} className="text-sm font-medium text-neutral-200">{label}</label>
                <button type="button" onClick={() => setVisible((current) => !current)} className="text-xs text-neutral-400 underline decoration-neutral-700 underline-offset-4 hover:text-white">
                    {visible ? "Hide" : "Show"}
                </button>
            </div>
            <input
                id={name}
                name={name}
                type={visible ? "text" : "password"}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onKeyUp={(event) => setCapsLock(event.getModifierState("CapsLock"))}
                onKeyDown={(event) => setCapsLock(event.getModifierState("CapsLock"))}
                autoComplete={autoComplete}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                minLength={showRequirements ? 12 : undefined}
                required
                disabled={disabled}
                aria-invalid={invalid}
                className={authInput}
                aria-describedby={showRequirements ? `${name}-requirements` : capsLock ? `${name}-caps` : undefined}
            />
            {capsLock ? <AuthFieldFeedback id={`${name}-caps`} tone="yellow" message="Caps Lock is on." /> : null}
            {showRequirements ? (
                <div id={`${name}-requirements`} className="mt-3 space-y-1.5">
                    {requirements.map((requirement) => (
                        <AuthFieldFeedback key={requirement.label} tone={requirement.met ? "green" : "grey"} message={requirement.label} />
                    ))}
                </div>
            ) : null}
        </div>
    )
}
