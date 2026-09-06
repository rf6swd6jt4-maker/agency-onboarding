"use client"

import { useRef, type Dispatch, type MutableRefObject, type PointerEvent, type RefObject, type SetStateAction, type UIEvent } from "react"
import { messagePaneIsAwayFromBottom } from "@/components/communications/JumpToLatestButton"

const POINTER_SCROLL_THRESHOLD_PX = 6
const USER_SCROLL_SETTLE_MS = 180

export function useMessagePaneInteractions(
    composerRef: RefObject<HTMLTextAreaElement | null>,
    followLatestRef: MutableRefObject<boolean>,
    setAtLatest: Dispatch<SetStateAction<boolean>>,
    setShowJumpToLatest: Dispatch<SetStateAction<boolean>>,
) {
    const pointerGestureRef = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null)
    const userScrollUntilRef = useRef(0)

    const markUserScroll = () => {
        userScrollUntilRef.current = performance.now() + USER_SCROLL_SETTLE_MS
    }

    return {
        onPointerDown(event: PointerEvent<HTMLDivElement>) {
            pointerGestureRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
            if (event.clientX - event.currentTarget.getBoundingClientRect().left >= event.currentTarget.clientWidth) markUserScroll()
        },
        onPointerMove(event: PointerEvent<HTMLDivElement>) {
            const gesture = pointerGestureRef.current
            if (!gesture || gesture.pointerId !== event.pointerId || gesture.moved) return
            if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < POINTER_SCROLL_THRESHOLD_PX) return
            gesture.moved = true
            markUserScroll()
            if (event.clientY > gesture.y) followLatestRef.current = false
        },
        onPointerUp(event: PointerEvent<HTMLDivElement>) {
            const gesture = pointerGestureRef.current
            pointerGestureRef.current = null
            if (!gesture || gesture.pointerId !== event.pointerId) return
            if (gesture.moved) markUserScroll()
            else if (!(event.target instanceof Element && event.target.closest("button,a,input,textarea,select,video,audio,[role='slider'],[data-message-control]"))) composerRef.current?.blur()
        },
        onPointerCancel() {
            if (pointerGestureRef.current?.moved) markUserScroll()
            pointerGestureRef.current = null
        },
        onWheel(event: { deltaY: number }) {
            markUserScroll()
            if (event.deltaY < 0) followLatestRef.current = false
        },
        onKeyDown(event: { key: string; target: EventTarget | null }) {
            if (event.target instanceof Element && event.target.closest("input,textarea,video,audio,button,[role='slider']")) return
            if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) {
                markUserScroll()
                if (["ArrowUp", "PageUp", "Home"].includes(event.key)) followLatestRef.current = false
            }
        },
        onScroll(event: UIEvent<HTMLDivElement>) {
            const pane = event.currentTarget
            if (pane.scrollLeft !== 0) pane.scrollLeft = 0
            const following = !messagePaneIsAwayFromBottom(pane, 24)
            const userScrolling = Boolean(pointerGestureRef.current?.moved) || performance.now() < userScrollUntilRef.current
            if (userScrolling) {
                markUserScroll()
                followLatestRef.current = following
            }
            setAtLatest(following)
            setShowJumpToLatest(messagePaneIsAwayFromBottom(pane))
        },
    }
}
