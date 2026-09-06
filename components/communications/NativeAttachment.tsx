"use client"

import Image from "next/image"
import { useCallback, useEffect, useRef, useState } from "react"
import { AnchoredPopup } from "@/components/ui"
import type { MessageMediaPreview } from "@/components/communications/MessageMediaLightbox"
import { LoadingSpinnerIcon, OpenWithIcon } from "@/components/communications/MessageInteractionIcons"
import { VoiceNotePlayer } from "@/components/communications/VoiceNotePlayer"
import type { CommunicationAttachment } from "@/lib/communications/types"
import { nativeAttachmentSizeLabel, nativeAttachmentTypeLabel } from "@/lib/communications/native-attachments"

function FileOptions({ attachment, onClose }: { attachment: CommunicationAttachment; onClose: () => void }) {
    const fileRef = useRef<File | null>(null)
    const requestRef = useRef<AbortController | null>(null)
    const [opening, setOpening] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const openRef = useRef<HTMLButtonElement>(null)
    const downloadUrl = `${attachment.url}${attachment.url.includes("?") ? "&" : "?"}download=${encodeURIComponent(attachment.fileName)}`

    useEffect(() => {
        openRef.current?.focus({ preventScroll: true })
        const cancel = () => {
            requestRef.current?.abort()
            requestRef.current = null
            setOpening(false)
        }
        const visibilityChanged = () => { if (document.hidden) cancel() }
        document.addEventListener("visibilitychange", visibilityChanged)
        window.addEventListener("pagehide", cancel)
        return () => {
            requestRef.current?.abort()
            document.removeEventListener("visibilitychange", visibilityChanged)
            window.removeEventListener("pagehide", cancel)
        }
    }, [])

    async function openWith() {
        if (requestRef.current) return
        if (!navigator.share || !navigator.canShare) {
            setError("This browser cannot open the device's app picker. Download the file to open it in an app.")
            return
        }
        const controller = new AbortController()
        requestRef.current = controller
        setOpening(true)
        setError(null)
        try {
            let file = fileRef.current
            if (!file) {
                const response = await fetch(attachment.url, { signal: controller.signal })
                if (!response.ok) throw new Error("Could not load this file. Try again or download it.")
                const blob = await response.blob()
                if (controller.signal.aborted) return
                file = new File([blob], attachment.fileName, { type: attachment.mimeType })
                fileRef.current = file
            }
            if (!navigator.canShare({ files: [file] })) {
                setError("This device cannot open this file through its app picker. Download it to open it in an app.")
                return
            }
            if (controller.signal.aborted || document.hidden) return
            await navigator.share({ files: [file] })
            if (!controller.signal.aborted) onClose()
        } catch (openError) {
            // A download can outlast the browser's activation window. Keep the
            // loaded file ready for a fresh tap, without an error or extra text.
            const quiet = openError instanceof Error && ["AbortError", "NotAllowedError"].includes(openError.name)
            if (!controller.signal.aborted && !quiet) {
                setError(openError instanceof Error ? openError.message : "Could not open this file. Try again or download it.")
            }
        } finally {
            if (requestRef.current === controller) {
                requestRef.current = null
                setOpening(false)
            }
        }
    }

    return <div className="w-72 max-w-full p-2 text-white">
        <div className="px-2 pb-2 pt-1">
            <p className="text-xs font-semibold">Open file</p>
            <p className="mt-1 break-words text-xs text-neutral-400">{attachment.fileName}</p>
        </div>
        <button ref={openRef} type="button" onClick={() => void openWith()} disabled={opening} aria-busy={opening} className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-left text-sm outline-none hover:bg-neutral-800 focus-visible:ring-1 focus-visible:ring-neutral-500 disabled:cursor-wait"><span>Open with…</span>{opening ? <LoadingSpinnerIcon /> : null}</button>
        <a href={downloadUrl} download={attachment.fileName} onClick={onClose} className="block rounded-lg px-2 py-2.5 text-sm outline-none hover:bg-neutral-800 focus-visible:ring-1 focus-visible:ring-neutral-500">Download</a>
        {error ? <p role="alert" className="px-2 py-2 text-xs text-red-300">{error}</p> : null}
    </div>
}

function AttachmentFileCard({ attachment, previewFailed = false }: { attachment: CommunicationAttachment; previewFailed?: boolean }) {
    const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
    const size = nativeAttachmentSizeLabel(attachment.size)
    function close() { anchor?.focus({ preventScroll: true }); setAnchor(null) }
    return <div className="mb-2 min-w-0" onClick={(event) => event.stopPropagation()}>
        <button type="button" aria-label={`Open ${attachment.fileName}`} aria-haspopup="dialog" aria-expanded={Boolean(anchor)} onClick={(event) => setAnchor(anchor ? null : event.currentTarget)} className="flex w-full min-w-0 items-center gap-3 rounded-xl border border-current/10 bg-black/5 px-3 py-2.5 text-left hover:bg-black/10">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-7 w-7 shrink-0 opacity-60"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" /><path d="M14 3v5h5M8 13h8M8 17h5" /></svg>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold" title={attachment.fileName}>{attachment.fileName}</span>
                <span className="mt-0.5 block truncate text-[10px] opacity-60">{nativeAttachmentTypeLabel(attachment)}{size ? ` · ${size}` : ""}</span>
                {previewFailed ? <span className="mt-1 block text-[10px] opacity-60">Preview unavailable · Open in an app</span> : null}
            </span>
            <OpenWithIcon className="h-5 w-5 shrink-0 opacity-75" />
        </button>
        <AnchoredPopup anchor={anchor} role="dialog" align="end" onDismiss={close} className="rounded-xl border border-neutral-800 bg-neutral-950 shadow-xl">
            {anchor ? <FileOptions attachment={attachment} onClose={close} /> : null}
        </AnchoredPopup>
    </div>
}

export function NativeAttachment({ attachment, onOpenImage, light = false }: { attachment: CommunicationAttachment; onOpenImage: (media: MessageMediaPreview) => void; light?: boolean }) {
    const [failedUrl, setFailedUrl] = useState<string | null>(null)
    const checkVideo = useCallback((video: HTMLVideoElement | null) => {
        // Cached/unsupported media can fail before hydration attaches onError.
        if (video?.error) setFailedUrl(attachment.url)
    }, [attachment.url])
    const failed = failedUrl === attachment.url
    if (attachment.kind === "sticker") return <Image unoptimized src={attachment.url} alt={attachment.fileName} width={512} height={512} className="h-auto max-h-48 w-auto max-w-48 object-contain drop-shadow-lg" />
    if (attachment.kind === "image" && !failed) return <button type="button" onClick={(event) => { event.stopPropagation(); onOpenImage({ url: attachment.url, alt: attachment.fileName }) }} aria-label={`Open ${attachment.fileName}`} className="mb-2 block w-full overflow-hidden rounded-xl bg-black/10"><Image unoptimized src={attachment.url} alt={attachment.fileName} width={800} height={600} onError={() => setFailedUrl(attachment.url)} className="max-h-80 h-auto w-full object-contain" /></button>
    if (attachment.kind === "video" && !failed) return <div onClick={(event) => event.stopPropagation()}>
        <video ref={checkVideo} src={`${attachment.url}#t=0.001`} controls playsInline preload="metadata" aria-label={attachment.fileName} onError={() => setFailedUrl(attachment.url)} className="mb-2 block h-auto w-full rounded-xl bg-black object-contain" style={{ maxHeight: "var(--native-video-max-height, 30rem)" }} />
        <AttachmentFileCard attachment={attachment} />
    </div>
    if (attachment.kind === "audio" && !failed) return <div onClick={(event) => event.stopPropagation()}>
        <VoiceNotePlayer src={attachment.url} fileName={attachment.fileName} light={light} onError={() => setFailedUrl(attachment.url)} />
        <AttachmentFileCard attachment={attachment} />
    </div>
    return <AttachmentFileCard attachment={attachment} previewFailed={failed} />
}
