"use client"

import { useLayoutEffect, type MutableRefObject, type RefObject, type Dispatch, type SetStateAction } from "react"
import { observeConversationLayout } from "@/components/communications/message-pane-observer"

export function useConversationLayout(
    paneRef: RefObject<HTMLDivElement | null>,
    followingLatest: MutableRefObject<boolean>,
    conversationId: string | null,
    active: boolean,
    setAtLatest: Dispatch<SetStateAction<boolean>>,
    setShowJump: Dispatch<SetStateAction<boolean>>,
) {
    useLayoutEffect(() => {
        const pane = paneRef.current
        if (!pane || !conversationId) return
        return observeConversationLayout(pane, followingLatest, (latest, away) => {
            setAtLatest(latest)
            setShowJump(away)
        })
    }, [conversationId, followingLatest, paneRef, setAtLatest, setShowJump])
    useLayoutEffect(() => {
        if (active) paneRef.current?.dispatchEvent(new Event("conversation-visible"))
    }, [active, paneRef])
}
