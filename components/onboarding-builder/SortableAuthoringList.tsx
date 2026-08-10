"use client"

import { useRef, useState, type PointerEvent, type ReactNode } from "react"

export function SortableAuthoringList<T extends { id: string }>({ items, onChange, renderItem, ariaLabel, disabled = false }: {
    items: T[]
    onChange: (items: T[]) => void
    renderItem: (item: T, index: number, handle: ReactNode) => ReactNode
    ariaLabel: string
    disabled?: boolean
}) {
    const [draggingId, setDraggingId] = useState<string | null>(null)
    const [keyboardId, setKeyboardId] = useState<string | null>(null)
    const [announcement, setAnnouncement] = useState("")
    const initialItems = useRef(items)

    function move(id: string, targetId: string) {
        const from = items.findIndex((item) => item.id === id)
        const to = items.findIndex((item) => item.id === targetId)
        if (from < 0 || to < 0 || from === to) return
        const next = [...items]
        const [item] = next.splice(from, 1)
        next.splice(to, 0, item)
        onChange(next)
        setAnnouncement(`Moved item to position ${to + 1} of ${next.length}.`)
    }

    function pointerDown(event: PointerEvent<HTMLButtonElement>, id: string) {
        if (disabled || event.button !== 0) return
        event.preventDefault()
        initialItems.current = items
        setDraggingId(id)
        event.currentTarget.setPointerCapture(event.pointerId)
    }

    function pointerMove(event: PointerEvent<HTMLButtonElement>, id: string) {
        if (draggingId !== id) return
        event.preventDefault()
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-sortable-id]")
        if (target?.dataset.sortableId) move(id, target.dataset.sortableId)
    }

    function finishPointer(event: PointerEvent<HTMLButtonElement>) {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        setDraggingId(null)
    }

    const handle = (item: T, index: number) => <button
        type="button"
        aria-label={`Drag item ${index + 1} of ${items.length}`}
        aria-pressed={keyboardId === item.id}
        disabled={disabled}
        onPointerDown={(event) => pointerDown(event, item.id)}
        onPointerMove={(event) => pointerMove(event, item.id)}
        onPointerUp={finishPointer}
        onPointerCancel={(event) => { onChange(initialItems.current); finishPointer(event) }}
        onKeyDown={(event) => {
            if (disabled) return
            if (event.key === " " || event.key === "Enter") {
                event.preventDefault()
                setKeyboardId((current) => current === item.id ? null : item.id)
                setAnnouncement(keyboardId === item.id ? "Item dropped." : "Item picked up. Use arrow keys to move it.")
                return
            }
            if (event.key === "Escape" && keyboardId === item.id) {
                event.preventDefault()
                setKeyboardId(null)
                return
            }
            if (keyboardId !== item.id || !["ArrowUp", "ArrowDown"].includes(event.key)) return
            event.preventDefault()
            const targetIndex = Math.max(0, Math.min(items.length - 1, index + (event.key === "ArrowUp" ? -1 : 1)))
            if (targetIndex !== index) move(item.id, items[targetIndex].id)
        }}
        className={`inline-flex h-10 w-10 shrink-0 touch-none select-none items-center justify-center rounded-lg text-neutral-500 outline-none transition hover:bg-neutral-800 hover:text-white focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-30 ${draggingId === item.id ? "cursor-grabbing bg-neutral-800 text-white" : "cursor-grab"}`}
    >
        <span aria-hidden="true" className="text-lg leading-none">⠿</span>
    </button>

    return <div role="list" aria-label={ariaLabel} className="space-y-2">
        {items.map((item, index) => <div key={item.id} role="listitem" data-sortable-id={item.id} className={draggingId === item.id ? "opacity-70" : ""}>{renderItem(item, index, handle(item, index))}</div>)}
        <p className="sr-only" aria-live="polite">{announcement}</p>
    </div>
}
