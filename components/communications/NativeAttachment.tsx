"use client"

import Image from "next/image"
import { useCallback, useEffect, useRef, useState } from "react"
import { AnchoredPopup } from "@/components/ui"
import type { MessageMediaPreview } from "@/components/communications/MessageMediaLightbox"
import { VoiceNotePlayer } from "@/components/communications/VoiceNotePlayer"
import type { CommunicationAttachment } from "@/lib/communications/types"
import { nativeAttachmentSizeLabel, nativeAttachmentTypeLabel } from "@/lib/communications/native-attachments"

function FileOptions({ attachment, onClose }: { attachment: CommunicationAttachment; onClose: () => void }) {
    const [file, setFile] = useState<File | null>(null)
    const [preparing, setPreparing] = useState(true)
    const [sharing, setSharing] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const downloadRef = useRef<HTMLAnchorElement>(null)
    const downloadUrl = `${attachment.url}${attachment.url.includes("?") ? "&" : "?"}download=${encodeURIComponent(attachment.fileName)}`

    useEffect(() => {
        const controller = new AbortController()
        downloadRef.current?.focus({ preventScroll: true })
        async function prepareFile() {
            try {
                if (!navigator.share || !navigator.canShare) return
                const response = await fetch(attachment.url, { signal: controller.signal })
                if (!response.ok) throw new Error("Could not prepare this file for another app. You can try downloading it.")
                const blob = await response.blob()
                const candidate = new File([blob], attachment.fileName, { type: attachment.mimeType })
                if (!controller.signal.aborted && navigator.canShare({ files: [candidate] })) setFile(candidate)
            } catch (prepareError) {
                if (!controller.signal.aborted) setError(prepareError instanceof Error ? prepareError.message : "Could not prepare this file.")
            } finally {
                if (!controller.signal.aborted) setPreparing(false)
            }
        }
        void prepareFile()
        return () => controller.abort()
    }, [attachment.url, attachment.fileName, attachment.mimeType])

    async function openWith() {
        if (!file || sharing) return
        setSharing(true)
        setError(null)
        try {
            // The file is already loaded: the picker must open during this fresh user gesture.
            await navigator.share({ files: [file] })
            onClose()
        } catch (shareError) {
            if (!(shareError instanceof Error && shareError.name === "AbortError")) {
                setError("This device could not open the app picker. Download the file to open it in an app.")
            }
        } finally {
            setSharing(false)
        }
    }

    return <div className="w-72 max-w-full p-2 text-white">
        <div className="px-2 pb-2 pt-1">
            <p className="text-xs font-semibold">Open file</p>
            <p className="mt-1 break-words text-xs text-neutral-400">{attachment.fileName}</p>
        </div>
        {preparing ? <p role="status" className="px-2 py-2 text-xs text-neutral-500">Preparing app options…</p> : file ? <button type="button" onClick={() => void openWith()} disabled={sharing} className="block w-full rounded-lg px-2 py-2.5 text-left text-sm hover:bg-neutral-800 disabled:opacity-50">{sharing ? "Opening…" : "Open with…"}</button> : <p className="px-2 pb-2 text-xs text-neutral-500">Download this file, then open it in an app on your device.</p>}
        <a ref={downloadRef} href={downloadUrl} download={attachment.fileName} onClick={onClose} className="block rounded-lg px-2 py-2.5 text-sm outline-none hover:bg-neutral-800 focus-visible:ring-1 focus-visible:ring-neutral-500">Download file</a>
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
            <span aria-hidden="true" className="shrink-0 opacity-60">↗</span>
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
        <video ref={checkVideo} src={`${attachment.url}#t=0.001`} controls playsInline preload="metadata" aria-label={attachment.fileName} onError={() => setFailedUrl(attachment.url)} className="mb-2 max-h-80 w-full rounded-xl bg-black" />
        <AttachmentFileCard attachment={attachment} />
    </div>
    if (attachment.kind === "audio" && !failed) return <div onClick={(event) => event.stopPropagation()}>
        <VoiceNotePlayer src={attachment.url} fileName={attachment.fileName} light={light} onError={() => setFailedUrl(attachment.url)} />
        <AttachmentFileCard attachment={attachment} />
    </div>
    return <AttachmentFileCard attachment={attachment} previewFailed={failed} />
}
