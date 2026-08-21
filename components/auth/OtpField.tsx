"use client"

import { useRef, useState } from "react"

export function OtpField({ value, onChange, onComplete, label = "Six-digit code", disabled = false, autoFocus = true, invalid = false }: { value: string; onChange: (value: string) => void; onComplete?: (value: string) => void; label?: string; disabled?: boolean; autoFocus?: boolean; invalid?: boolean }) {
    const input = useRef<HTMLInputElement>(null)
    const [focused, setFocused] = useState(false)
    const digits = Array.from({ length: 6 }, (_, index) => value[index] ?? "")
    return (
        <div>
            <label htmlFor="one-time-code" className="text-sm font-medium text-neutral-200">{label}</label>
            <div className="relative mt-3" onClick={() => input.current?.focus()}>
                <input
                    ref={input}
                    id="one-time-code"
                    name="code"
                    value={value}
                    onChange={(event) => { const next = event.target.value.replace(/\D/g, "").slice(0, 6); onChange(next); if (next.length === 6 && next !== value) onComplete?.(next) }}
                    onPaste={(event) => {
                        const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6)
                        if (pasted) { event.preventDefault(); onChange(pasted); if (pasted.length === 6 && pasted !== value) onComplete?.(pasted) }
                    }}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="one-time-code"
                    enterKeyHint="done"
                    minLength={6}
                    maxLength={6}
                    autoFocus={autoFocus}
                    disabled={disabled}
                    aria-invalid={invalid}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    className="absolute inset-0 z-10 h-full w-full cursor-text opacity-0 disabled:cursor-not-allowed"
                    aria-describedby="otp-help"
                />
                <div aria-hidden="true" className="grid grid-cols-6 gap-2">
                    {digits.map((digit, index) => (
                        <span key={index} className={`flex aspect-square items-center justify-center rounded-lg border bg-neutral-950 text-xl font-semibold tabular-nums transition ${focused && index === Math.min(value.length, 5) ? "border-neutral-300 ring-2 ring-white/10" : digit ? "border-neutral-500" : "border-neutral-700"}`}>
                            {digit}
                        </span>
                    ))}
                </div>
            </div>
            <p id="otp-help" className="mt-3 text-xs leading-5 text-neutral-500">Paste the complete code or type it from left to right.</p>
        </div>
    )
}
