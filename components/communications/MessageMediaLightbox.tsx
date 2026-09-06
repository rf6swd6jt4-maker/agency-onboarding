"use client"

import Image from "next/image"
import { useEffect } from "react"

export type MessageMediaPreview = { url: string; alt: string }

export function MessageMediaLightbox({ media, onClose }: { media: MessageMediaPreview | null; onClose: () => void }) {
    useEffect(() => {
        if (!media) return
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = "hidden"
        const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose() }
        window.addEventListener("keydown", closeOnEscape)
        return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", closeOnEscape) }
    }, [media, onClose])

    if (!media) return null
    return <div role="dialog" aria-modal="true" aria-label="Image preview" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }} className="betelgeze-popup-fade fixed inset-0 z-[180] flex items-center justify-center bg-black/95 p-3 sm:p-8">
        <button type="button" onClick={onClose} aria-label="Close image preview" className="absolute right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-neutral-900/90 text-2xl text-white shadow-xl hover:bg-neutral-800 sm:right-5 sm:top-5">×</button>
        <Image unoptimized src={media.url} alt={media.alt} width={1800} height={1400} className="max-h-[calc(100dvh-1.5rem)] max-w-full object-contain sm:max-h-[calc(100dvh-4rem)]" />
    </div>
}
