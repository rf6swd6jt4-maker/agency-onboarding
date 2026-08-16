"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"

import { CopyIcon, DeleteIcon, PinIcon, ReactIcon, ReplyIcon } from "@/components/communications/MessageInteractionIcons"

const DEFAULT_REACTIONS = ["👍", "❤️", "😂", "😮", "😢"]
const ACTION_BUTTON_CLASS = "inline-flex h-10 w-10 min-h-10 min-w-10 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-800 hover:text-white lg:h-8 lg:w-8 lg:min-h-8 lg:min-w-8"

export type MessageActionView = "actions" | "reactions"

export function recentReactionChoices(recentEmoji: string | null) {
    if (!recentEmoji) return DEFAULT_REACTIONS
    return [recentEmoji, ...DEFAULT_REACTIONS.filter((emoji) => emoji !== recentEmoji)].slice(0, DEFAULT_REACTIONS.length)
}

export async function copyMessageText(value: string) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
        return
    }
    const textarea = document.createElement("textarea")
    textarea.value = value
    textarea.setAttribute("readonly", "")
    textarea.style.position = "fixed"
    textarea.style.opacity = "0"
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand("copy")
    textarea.remove()
    if (!copied) throw new Error("Copy is unavailable on this device.")
}

function ActionButton({ label, onClick, children, danger = false, pressed }: { label: string; onClick: () => void; children: ReactNode; danger?: boolean; pressed?: boolean }) {
    return <button data-icon-button type="button" onClick={onClick} aria-label={label} aria-pressed={pressed} className={`${ACTION_BUTTON_CLASS} ${danger ? "text-red-500 hover:bg-red-500/10 hover:text-red-400" : ""}`}>{children}</button>
}

export function PrimaryMessageActions({ onDelete, onReply, onCopy, onPin, onReact, pinned }: {
    onDelete: (() => void) | null
    onReply: (() => void) | null
    onCopy: () => void
    onPin: (() => void) | null
    onReact: (() => void) | null
    pinned: boolean
}) {
    return <div className="flex items-center rounded-full border border-neutral-800 bg-neutral-950 p-1 shadow-xl">
        {onDelete ? <ActionButton label="Delete message" onClick={onDelete} danger><DeleteIcon className="h-5 w-5 lg:h-4 lg:w-4" /></ActionButton> : null}
        {onReply ? <ActionButton label="Reply" onClick={onReply}><ReplyIcon className="h-5 w-5 lg:h-4 lg:w-4" /></ActionButton> : null}
        <ActionButton label="Copy message" onClick={onCopy}><CopyIcon className="h-5 w-5 lg:h-4 lg:w-4" /></ActionButton>
        {onPin ? <ActionButton label={pinned ? "Unpin message" : "Pin message"} onClick={onPin} pressed={pinned}><PinIcon className="h-5 w-5 lg:h-4 lg:w-4" /></ActionButton> : null}
        {onReact ? <ActionButton label="React to message" onClick={onReact}><ReactIcon className="h-5 w-5 lg:h-4 lg:w-4" /></ActionButton> : null}
    </div>
}

export function MessageReactionActions({ currentEmoji, recentEmoji, onReact, onRecentEmoji, side }: {
    currentEmoji: string | null
    recentEmoji: string | null
    onReact: (emoji: string) => void
    onRecentEmoji: (emoji: string) => void
    side: "left" | "right"
}) {
    const [customOpen, setCustomOpen] = useState(false)
    const [customEmoji, setCustomEmoji] = useState("")
    const [customError, setCustomError] = useState<string | null>(null)
    const inputRef = useRef<HTMLInputElement | null>(null)

    useEffect(() => {
        if (customOpen) window.requestAnimationFrame(() => inputRef.current?.focus())
    }, [customOpen])

    function submitCustom() {
        const emoji = customEmoji.trim()
        if (!emoji) return
        const segments = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(emoji)]
        if (segments.length !== 1 || !/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(emoji)) {
            setCustomError("Choose one emoji.")
            return
        }
        onRecentEmoji(emoji)
        onReact(currentEmoji === emoji ? "" : emoji)
        setCustomEmoji("")
        setCustomOpen(false)
    }

    return <div className="relative">
        <div className="flex items-center rounded-full border border-neutral-800 bg-neutral-950 p-1 shadow-xl">
            {recentReactionChoices(recentEmoji).map((emoji) => <button data-icon-button key={emoji} type="button" onClick={() => onReact(currentEmoji === emoji ? "" : emoji)} aria-label={`React with ${emoji}`} aria-pressed={currentEmoji === emoji} className={`inline-flex h-10 w-10 min-h-10 min-w-10 shrink-0 items-center justify-center rounded-full text-lg hover:bg-neutral-800 lg:h-8 lg:w-8 lg:min-h-8 lg:min-w-8 lg:text-base ${currentEmoji === emoji ? "bg-neutral-800" : ""}`}>{emoji}</button>)}
            <button data-icon-button type="button" onClick={() => setCustomOpen((open) => !open)} aria-label="Use device emoji picker" aria-expanded={customOpen} className={`${ACTION_BUTTON_CLASS} text-xl lg:text-lg`}>+</button>
        </div>
        {customOpen ? <form onSubmit={(event) => { event.preventDefault(); submitCustom() }} className={`absolute bottom-12 flex w-64 gap-2 rounded-xl border border-neutral-800 bg-neutral-950 p-2 shadow-2xl lg:bottom-10 ${side === "right" ? "right-0" : "left-0"}`}>
            <label className="min-w-0 flex-1"><span className="sr-only">Emoji reaction</span><input ref={inputRef} inputMode="text" value={customEmoji} onChange={(event) => { setCustomEmoji(event.target.value); setCustomError(null) }} maxLength={32} aria-invalid={Boolean(customError)} placeholder="Use device emoji picker" className="h-10 w-full rounded-lg border border-neutral-800 bg-black px-3 text-base outline-none focus:border-neutral-600 lg:h-9 lg:text-sm" />{customError ? <span className="mt-1 block text-[10px] text-red-400">{customError}</span> : null}</label>
            <button type="submit" className="h-10 rounded-lg bg-white px-3 text-xs font-semibold text-black lg:h-9">React</button>
        </form> : null}
    </div>
}
