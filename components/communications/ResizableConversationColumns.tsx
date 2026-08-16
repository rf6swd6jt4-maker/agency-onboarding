"use client"

import { type CSSProperties, type PointerEvent, type ReactNode, useRef, useState } from "react"

const DEFAULT_LIST_WIDTH = 352
const MIN_LIST_WIDTH = 288
const MAX_LIST_WIDTH = 448

function ResizeIcon() {
    return <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5 fill-none stroke-current stroke-[1.7]"><path d="m7 6-4 4 4 4M13 6l4 4-4 4M10 4v12" /></svg>
}

export function ResizableConversationColumns({ children }: { children: ReactNode }) {
    const [listWidth, setListWidth] = useState(DEFAULT_LIST_WIDTH)
    const containerRef = useRef<HTMLDivElement | null>(null)

    function resize(event: PointerEvent<HTMLButtonElement>) {
        const rect = containerRef.current?.getBoundingClientRect()
        if (!rect) return
        const containerMaximum = Math.max(MIN_LIST_WIDTH, Math.round(rect.width * 0.42))
        setListWidth(Math.max(MIN_LIST_WIDTH, Math.min(MAX_LIST_WIDTH, containerMaximum, Math.round(event.clientX - rect.left))))
    }

    return <div
        ref={containerRef}
        style={{ "--conversation-list-width": `${listWidth}px` } as CSSProperties}
        className="relative grid min-h-0 min-w-0 flex-1 overflow-hidden lg:grid-cols-[var(--conversation-list-width)_minmax(0,1fr)]"
    >
        {children}
        <button
            type="button"
            aria-label="Resize chat list"
            title="Drag to resize chat list"
            onPointerDown={(event) => {
                if (event.button !== 0) return
                event.preventDefault()
                event.currentTarget.setPointerCapture(event.pointerId)
                resize(event)
            }}
            onPointerMove={(event) => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
                resize(event)
            }}
            onDoubleClick={() => setListWidth(DEFAULT_LIST_WIDTH)}
            className="group absolute inset-y-0 z-30 hidden w-4 -translate-x-1/2 touch-none cursor-col-resize items-center justify-center outline-none lg:flex"
            style={{ left: "var(--conversation-list-width)" }}
        >
            <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-neutral-600 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-active:opacity-100" />
            <span className="pointer-events-none relative flex h-8 w-5 items-center justify-center rounded-full border border-neutral-700 bg-neutral-950 text-neutral-400 opacity-0 shadow-xl transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-active:opacity-100"><ResizeIcon /></span>
        </button>
    </div>
}
