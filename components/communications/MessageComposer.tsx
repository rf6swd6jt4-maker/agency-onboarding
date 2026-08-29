"use client"

import type { ReactNode, RefObject } from "react"

export function MessageComposer({
    textareaRef,
    draft,
    placeholder,
    disabled,
    sendDisabled,
    leadingActions,
    submitLabel = "Send message",
    submitIcon,
    onDraftChange,
    onBlur,
    onSend,
}: {
    textareaRef: RefObject<HTMLTextAreaElement | null>
    draft: string
    placeholder: string
    disabled: boolean
    sendDisabled: boolean
    leadingActions: ReactNode
    submitLabel?: string
    submitIcon?: ReactNode
    onDraftChange: (value: string) => void
    onBlur?: () => void
    onSend: () => void
}) {
    return <>
        <form
            data-workspace-mutation-scope="local"
            onSubmit={(event) => {
                event.preventDefault()
                if (!sendDisabled) onSend()
            }}
            className="mx-auto flex max-w-3xl touch-manipulation items-center gap-1.5 rounded-2xl border border-neutral-800 bg-black px-1.5 py-1.5 focus-within:border-neutral-600"
        >
            <div className="flex shrink-0 items-center -space-x-1">{leadingActions}</div>
            <div className="relative min-w-0 flex-1">
                {!draft ? <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 truncate text-base leading-6 text-neutral-600 lg:text-sm lg:leading-5">{placeholder}</span> : null}
                <textarea
                    ref={textareaRef}
                    rows={1}
                    value={draft}
                    enterKeyHint="send"
                    onClick={(event) => {
                        if (document.activeElement !== event.currentTarget) event.currentTarget.focus({ preventScroll: true })
                    }}
                    onChange={(event) => onDraftChange(event.target.value)}
                    onBlur={onBlur}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                            event.preventDefault()
                            if (!sendDisabled) onSend()
                        }
                    }}
                    disabled={disabled}
                    aria-label={placeholder}
                    className="relative h-11 min-h-11 w-full resize-none overflow-y-hidden bg-transparent py-2.5 text-base leading-6 outline-none disabled:cursor-not-allowed lg:h-9 lg:min-h-9 lg:py-2 lg:text-sm lg:leading-5"
                />
            </div>
            <button data-icon-button type="submit" disabled={sendDisabled} aria-label={submitLabel} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-black disabled:bg-neutral-800 disabled:text-neutral-600 lg:h-9 lg:w-9">
                {submitIcon ?? <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2"><path d="m4 4 17 8-17 8 3-8-3-8Z" /><path d="M7 12h14" /></svg>}
            </button>
        </form>
        <p className="mx-auto mt-2 hidden max-w-3xl text-center text-[10px] text-neutral-600 lg:block">Enter to send · Shift+Enter for a new line</p>
    </>
}
