"use client"

import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from "react"
import { createMediaQueue } from "@/lib/communications/media-queue"

const MediaActive = createContext(true)
const MediaQueue = createContext<ReturnType<typeof createMediaQueue> | null>(null)

export function ConversationMedia({ active, children }: { active: boolean; children: ReactNode }) {
    const [queue] = useState(() => createMediaQueue())
    return <MediaActive.Provider value={active}><MediaQueue.Provider value={queue}>{children}</MediaQueue.Provider></MediaActive.Provider>
}

/** Admission is one-way: scrolling away never clears src or unloads a preview. */
export function useConversationMedia(loadsPreview: boolean) {
    const active = useContext(MediaActive)
    const queue = useContext(MediaQueue)
    const ref = useRef<HTMLDivElement>(null)
    const admittedRef = useRef(false)
    const completeRef = useRef<(() => void) | null>(null)
    const [admitted, setAdmitted] = useState(false)
    const complete = useCallback(() => { completeRef.current?.(); completeRef.current = null }, [])
    useEffect(() => {
        const element = ref.current
        if (!active || admittedRef.current || !element) return
        const root = element.closest("[data-message-pane]")
        let cancel: (() => void) | null = null
        let timeout = 0
        const start = (done: () => void) => {
            admittedRef.current = true
            completeRef.current = done
            setAdmitted(true)
            observer.disconnect()
            if (!loadsPreview) complete()
            else timeout = window.setTimeout(complete, 15000)
        }
        const observer = new IntersectionObserver((entries) => {
            const entry = entries.find((entry) => entry.isIntersecting)
            if (!entry) { cancel?.(); cancel = null; return }
            if (cancel || admittedRef.current) return
            const bounds = root?.getBoundingClientRect()
            const visible = !bounds || (entry.boundingClientRect.bottom > bounds.top && entry.boundingClientRect.top < bounds.bottom)
            if (queue) cancel = queue.add(visible ? 0 : 1, start)
            else start(() => undefined)
        }, { root, rootMargin: "160px 0px" })
        observer.observe(element)
        return () => { observer.disconnect(); cancel?.(); window.clearTimeout(timeout); complete() }
    }, [active, complete, loadsPreview, queue])
    return { ref, admitted, complete }
}
