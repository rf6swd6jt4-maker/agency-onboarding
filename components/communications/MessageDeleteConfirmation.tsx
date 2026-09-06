"use client"

import { useEffect, useId, useRef } from "react"

/** Persistent confirmation: opening it does not rely on a browser JS prompt. */
export function MessageDeleteConfirmation({ open, own, preview, onCancel, onConfirm }: {
    open: boolean
    own: boolean
    preview: string
    onCancel: () => void
    onConfirm: () => void
}) {
    const dialogRef = useRef<HTMLDialogElement>(null)
    const cancelRef = useRef<HTMLButtonElement>(null)
    const titleId = useId()
    const descriptionId = useId()
    useEffect(() => {
        const dialog = dialogRef.current
        if (!dialog) return
        if (!open) { onCancel(); return }
        dialog.showModal()
        cancelRef.current?.focus({ preventScroll: true })
        return () => dialog.close()
    }, [open, onCancel])

    return <dialog ref={dialogRef} aria-labelledby={titleId} aria-describedby={descriptionId}
        onCancel={(event) => { event.preventDefault(); onCancel() }}
        className="m-auto w-[calc(100%_-_2rem)] max-w-sm overflow-visible rounded-2xl border border-neutral-700 bg-neutral-950 p-0 text-white shadow-2xl backdrop:bg-black/70"
    >
        <div className="betelgeze-popup-enter p-5">
            <h2 id={titleId} className="text-base font-semibold">{own ? "Delete this message?" : "Remove this message?"}</h2>
            <p id={descriptionId} className="mt-2 text-sm text-neutral-400">This removes the message for everyone and cannot be undone.</p>
            <p className="mt-3 line-clamp-3 whitespace-pre-wrap break-words text-sm text-neutral-300">{preview}</p>
            <div className="mt-5 flex justify-end gap-2">
                <button ref={cancelRef} type="button" onClick={onCancel} className="min-h-11 rounded-lg border border-neutral-700 px-4 text-sm font-medium hover:bg-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-400">Cancel</button>
                <button type="button" onClick={onConfirm} className="min-h-11 rounded-lg border border-red-800 bg-red-950 px-4 text-sm font-medium text-red-100 hover:bg-red-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400">Delete message</button>
            </div>
        </div>
    </dialog>
}
