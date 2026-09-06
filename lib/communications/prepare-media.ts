"use client"

import { nativeAttachmentMimeType } from "@/lib/communications/native-attachments"
import type { CommunicationAttachment } from "@/lib/communications/types"

export type PreparedMedia = Pick<CommunicationAttachment, "width" | "height" | "duration"> & { preview?: Blob }

/** Read local metadata while uploading. Unsupported files still send normally. */
export async function prepareCommunicationMedia(file: File): Promise<PreparedMedia> {
    const kind = nativeAttachmentMimeType(file.type, file.name).split("/", 1)[0]
    if (!["image", "video", "audio"].includes(kind)) return {}
    const url = URL.createObjectURL(file)
    let cleanup = () => undefined as void
    try {
        return await new Promise<PreparedMedia>((resolve) => {
            let settled = false
            const finish = (result: PreparedMedia) => { if (!settled) { settled = true; resolve(result) } }
            const timer = window.setTimeout(() => finish({}), 2500)
            const draw = async (source: CanvasImageSource, width: number, height: number, duration?: number) => {
                const result: PreparedMedia = { width, height, ...(Number.isFinite(duration) && duration! > 0 ? { duration } : {}) }
                try {
                    const scale = Math.min(1, 960 / Math.max(width, height))
                    const canvas = document.createElement("canvas")
                    canvas.width = Math.max(1, Math.round(width * scale))
                    canvas.height = Math.max(1, Math.round(height * scale))
                    canvas.getContext("2d")?.drawImage(source, 0, 0, canvas.width, canvas.height)
                    const preview = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/webp", 0.78))
                    if (preview && preview.type === "image/webp" && preview.size <= 300_000) result.preview = preview
                } catch { /* Metadata remains useful when this format cannot be drawn. */ }
                finish(result)
            }
            if (kind === "image") {
                const image = new Image()
                cleanup = () => { window.clearTimeout(timer); image.onload = null; image.onerror = null; image.src = "" }
                image.onload = () => {
                    // Keep animated originals animated; the server also checks pages.
                    if (["image/gif", "image/webp", "image/avif"].includes(file.type)) finish({ width: image.naturalWidth, height: image.naturalHeight })
                    else void draw(image, image.naturalWidth, image.naturalHeight)
                }
                image.onerror = () => finish({})
                image.src = url
            } else {
                const media = document.createElement(kind === "video" ? "video" : "audio")
                cleanup = () => { window.clearTimeout(timer); media.onloadedmetadata = null; media.onloadeddata = null; media.onerror = null; media.pause(); media.removeAttribute("src"); media.load() }
                media.preload = kind === "video" ? "auto" : "metadata"
                media.muted = true
                media.onloadedmetadata = () => {
                    if (media instanceof HTMLVideoElement) {
                        // Keep dimensions even if a first frame cannot be decoded.
                        window.clearTimeout(timer)
                        const frameTimer = window.setTimeout(() => finish({ width: media.videoWidth, height: media.videoHeight, duration: media.duration }), 700)
                        const previousCleanup = cleanup
                        cleanup = () => { window.clearTimeout(frameTimer); previousCleanup() }
                    } else finish({ duration: media.duration })
                }
                media.onloadeddata = () => { if (media instanceof HTMLVideoElement) void draw(media, media.videoWidth, media.videoHeight, media.duration) }
                media.onerror = () => finish({})
                media.src = url
            }
        })
    } finally { cleanup(); URL.revokeObjectURL(url) }
}
