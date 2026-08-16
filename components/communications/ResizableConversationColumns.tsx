"use client"

import { type CSSProperties, type PointerEvent, type ReactNode, useRef, useState } from "react"

const DEFAULT_LIST_WIDTH = 352
const MIN_LIST_WIDTH = 288
const MAX_LIST_WIDTH = 448

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
            className="absolute inset-y-0 z-30 hidden w-4 -translate-x-1/2 touch-none cursor-col-resize outline-none lg:block"
            style={{ left: "var(--conversation-list-width)" }}
        />
    </div>
}
