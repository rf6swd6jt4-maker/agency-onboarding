"use client"

import { useCallback, useState, type ComponentProps } from "react"

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

    // The message pane is the size container. Cap the video at two-thirds of
    // its height (up to 480px) and 560px wide; captions follow the resulting width.
    const videoWidth = aspectRatio
        ? `calc(min(35rem, min(66.6667cqh, 30rem) * ${aspectRatio}) + 1.75rem)`
        : "min(35rem, 100%)"

    return <article {...props} ref={attachBubble}
        style={{ ...style, ...(video ? { width: videoWidth } : {}) }}
        onLoadedMetadataCapture={(event) => {
            const media = event.target
            if (media instanceof HTMLVideoElement) readVideo(media)
            props.onLoadedMetadataCapture?.(event)
        }}
    >{children}</article>
}
