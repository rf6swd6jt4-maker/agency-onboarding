"use client"

import { useEffect, useRef, useState, type ComponentProps } from "react"
import { createMessageLongPress } from "@/lib/communications/message-long-press"

function isMessageControl(target: EventTarget | null) {
    return target instanceof Element && Boolean(target.closest("video,audio,button,a,input,textarea,select,[role='slider'],[data-message-control]"))
}

export function NativeMessageBubble({ video, style, children, onOpenActions, ...props }: Omit<ComponentProps<"article">, "ref" | "onClick" | "onContextMenu" | "onKeyDown"> & { video: boolean; onOpenActions: () => void }) {
    const [longPress] = useState(createMessageLongPress)
    const suppressClick = useRef(false)
    const lastTouchAt = useRef(0)
    useEffect(() => () => longPress.cancel(), [longPress])
    // Media metadata must never resize the surrounding bubble after paint.
    return <article {...props} role="button" data-message-bubble aria-haspopup="menu"
        style={{ ...style, ...(video ? { width: "min(35rem, 100%)" } : {}) }}
        // Native video controls retarget timeline touches to the video element.
        // Leave their default behavior alone and do not start a bubble gesture.
        onTouchStart={(event) => {
            lastTouchAt.current = Date.now()
            suppressClick.current = false
            longPress.cancel()
            if (event.touches.length !== 1) { props.onTouchCancel?.(event); return }
            if (isMessageControl(event.target)) return
            props.onTouchStart?.(event)
            const touch = event.touches[0]
            longPress.start(touch.clientX, touch.clientY, () => {
                suppressClick.current = true
                // A held message must not also finish as a swipe-to-reply/delete.
                props.onTouchCancel?.(event)
                onOpenActions()
            })
        }}
        onTouchMove={(event) => {
            if (event.touches.length !== 1) { longPress.cancel(); props.onTouchCancel?.(event); return }
            const touch = event.touches[0]
            longPress.move(touch.clientX, touch.clientY)
            if (!suppressClick.current && !isMessageControl(event.target)) props.onTouchMove?.(event)
        }}
        onTouchEnd={(event) => {
            lastTouchAt.current = Date.now()
            longPress.cancel()
            if (!suppressClick.current && !isMessageControl(event.target)) props.onTouchEnd?.(event)
        }}
        onTouchCancel={(event) => {
            longPress.cancel()
            if (!isMessageControl(event.target)) props.onTouchCancel?.(event)
        }}
        onClickCapture={(event) => {
            if (suppressClick.current) {
                suppressClick.current = false
                event.preventDefault()
                event.stopPropagation()
                return
            }
            props.onClickCapture?.(event)
        }}
        onClick={(event) => {
            // Assistive technology activates with a zero-detail click rather than
            // a physical pointer click. Keep that non-pointer action accessible.
            if (event.detail === 0 && !isMessageControl(event.target)) onOpenActions()
        }}
        onContextMenu={(event) => {
            if (isMessageControl(event.target)) return
            event.preventDefault()
            // Mobile browsers may emit contextmenu before or after touchend.
            // The hold timer owns touch activation; never open twice or after a swipe.
            const pointerType = (event.nativeEvent as PointerEvent).pointerType
            if (pointerType === "touch" || (pointerType !== "mouse" && Date.now() - lastTouchAt.current < 800)) return
            onOpenActions()
        }}
        onKeyDown={(event) => {
            if (isMessageControl(event.target)) return
            if (event.key === "Enter" || event.key === " " || event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                event.preventDefault()
                onOpenActions()
            }
        }}
    >{children}</article>
}
