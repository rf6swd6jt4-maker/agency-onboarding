"use client"

import { useCallback, useState, type ComponentProps } from "react"

function isMessageControl(target: EventTarget | null) {
    return target instanceof Element && Boolean(target.closest("video,audio,button,a,input,textarea,select,[role='slider'],[data-message-control]"))
}

export function NativeMessageBubble({ video, style, children, ...props }: Omit<ComponentProps<"article">, "ref"> & { video: boolean }) {
    const [aspectRatio, setAspectRatio] = useState<number | null>(null)
    const readVideo = useCallback((element: HTMLVideoElement) => {
        if (element.videoWidth > 0 && element.videoHeight > 0) {
            setAspectRatio(element.videoWidth / element.videoHeight)
        }
    }, [])
    const attachBubble = useCallback((element: HTMLElement | null) => {
        const media = element?.querySelector("video")
        if (media && !media.error) readVideo(media)
    }, [readVideo])

    // The full chat supplies a keyboard-independent height limit. Keep portrait
    // captions readable, allowing modest side bars when the minimum width wins.
    const videoWidth = aspectRatio
        ? `max(20rem, calc(min(35rem, var(--native-video-max-height, 30rem) * ${aspectRatio}) + 1.75rem))`
        : "min(35rem, 100%)"

    return <article {...props} ref={attachBubble}
        style={{ ...style, ...(video ? { width: videoWidth } : {}) }}
        // Native video controls retarget timeline touches to the video element.
        // Leave their default behavior alone and do not start a bubble gesture.
        onTouchStart={(event) => { if (!isMessageControl(event.target)) props.onTouchStart?.(event) }}
        onTouchMove={(event) => { if (!isMessageControl(event.target)) props.onTouchMove?.(event) }}
        onTouchEnd={(event) => { if (!isMessageControl(event.target)) props.onTouchEnd?.(event) }}
        onTouchCancel={(event) => { if (!isMessageControl(event.target)) props.onTouchCancel?.(event) }}
        onClick={(event) => { if (!isMessageControl(event.target)) props.onClick?.(event) }}
        onKeyDown={(event) => { if (!isMessageControl(event.target)) props.onKeyDown?.(event) }}
        onLoadedMetadataCapture={(event) => {
            const media = event.target
            if (media instanceof HTMLVideoElement) readVideo(media)
            props.onLoadedMetadataCapture?.(event)
        }}
    >{children}</article>
}
