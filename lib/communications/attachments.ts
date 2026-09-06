import type { CommunicationAttachment } from "@/lib/communications/types"

const IMAGE_TYPES = new Set(["image/jpeg", "image/png"])
const VIDEO_TYPES = new Set(["video/mp4", "video/3gpp", "video/3sp"])
const AUDIO_TYPES = new Set(["audio/aac", "audio/mp4", "audio/mpeg", "audio/ogg"])
const DOCUMENT_TYPES = new Set([
    "text/plain",
    "application/pdf",
    "application/msword",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
])
const STICKER_TYPES = new Set(["image/webp"])

export const MAX_COMMUNICATION_IMAGE_SIZE = 5 * 1024 * 1024
export const MAX_COMMUNICATION_VIDEO_SIZE = 16 * 1024 * 1024
export const MAX_COMMUNICATION_AUDIO_SIZE = 16 * 1024 * 1024
export const MAX_COMMUNICATION_DOCUMENT_SIZE = 100 * 1024 * 1024
export const MAX_COMMUNICATION_STICKER_SIZE = 100 * 1024
export const MAX_COMMUNICATION_MEDIA_CAPTION_LENGTH = 900

function record(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {}
}

function text(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : null
}

function number(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0
        ? value
        : null
}

export function communicationAttachmentKind(mimeType: string) {
    const normalized = mimeType.toLowerCase().split(";", 1)[0].trim()
    if (IMAGE_TYPES.has(normalized)) return "image" as const
    if (VIDEO_TYPES.has(normalized)) return "video" as const
    if (AUDIO_TYPES.has(normalized)) return "audio" as const
    if (DOCUMENT_TYPES.has(normalized)) return "document" as const
    if (STICKER_TYPES.has(normalized)) return "sticker" as const
    return null
}

export function communicationAttachmentLimit(kind: CommunicationAttachment["kind"]) {
    if (kind === "image") return MAX_COMMUNICATION_IMAGE_SIZE
    if (kind === "video") return MAX_COMMUNICATION_VIDEO_SIZE
    if (kind === "audio") return MAX_COMMUNICATION_AUDIO_SIZE
    if (kind === "sticker") return MAX_COMMUNICATION_STICKER_SIZE
    return MAX_COMMUNICATION_DOCUMENT_SIZE
}

export function validateCommunicationAttachmentFile(input: {
    name: string
    size: number
    type: string
}) {
    const kind = communicationAttachmentKind(input.type)
    if (!kind) return { error: "Use a JPEG, PNG, MP4, PDF, Word, Excel, PowerPoint, or text file." } as const
    if (kind === "audio") return { error: "Voice notes can currently be received in chat but not sent from Betelgeze." } as const
    if (kind === "sticker") return { error: "Add stickers through the tray using a JPEG or PNG source." } as const
    if (!input.name.trim() || !Number.isFinite(input.size) || input.size <= 0) {
        return { error: "Choose a non-empty attachment." } as const
    }
    if (input.size > communicationAttachmentLimit(kind)) {
        const limit = Math.round(communicationAttachmentLimit(kind) / 1024 / 1024)
        return { error: `${kind === "document" ? "Files" : `${kind[0].toUpperCase()}${kind.slice(1)}s`} can be up to ${limit}MB.` } as const
    }
    return { kind } as const
}

function attachmentUrl(storagePath: string) {
    return `/api/client-messages/media/${storagePath.split("/").map(encodeURIComponent).join("/")}`
}

export function communicationAttachmentFromValue(value: unknown): CommunicationAttachment | null {
    const source = record(value)
    const storagePath = text(source.storagePath) ?? text(source.storage_path)
    const rawFileName = text(source.fileName) ?? text(source.file_name)
    const fileName = rawFileName?.replace(/[\u0000-\u001f\u007f]/gu, " ").trim() ?? null
    const mimeType = text(source.mimeType) ?? text(source.mime_type)
    const explicitKind = text(source.kind) ?? text(source.type)
    const kind = explicitKind === "image" || explicitKind === "video" || explicitKind === "audio" || explicitKind === "document" || explicitKind === "sticker"
        ? explicitKind
        : mimeType ? communicationAttachmentKind(mimeType) ?? "document" : null
    if (!storagePath || !fileName || fileName.length > 180 || !mimeType || !kind) return null
    return {
        kind,
        fileName,
        mimeType,
        size: number(source.size),
        storagePath,
        url: attachmentUrl(storagePath),
        ...communicationMediaMetadata(source),
    }
}

export function communicationAttachmentFromRawPayload(value: unknown) {
    const raw = record(value)
    return communicationAttachmentFromValue(raw.bridge_media ?? raw.attachment)
}

/** Metadata is a layout hint, never an authorization or file-validation input. */
export function communicationMediaMetadata(value: unknown) {
    const source = value && typeof value === "object" ? value as Record<string, unknown> : {}
    const dimension = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 32768
    const dimensions = dimension(source.width) && dimension(source.height) ? { width: source.width, height: source.height } : {}
    const duration = typeof source.duration === "number" && Number.isFinite(source.duration) && source.duration > 0 && source.duration <= 604800 ? source.duration : undefined
    return { ...dimensions, ...(duration ? { duration } : {}), ...(source.hasPreview === true ? { hasPreview: true } : {}) }
}

export function communicationMediaRatio(media: { width?: number; height?: number; kind: string }) {
    const { width, height } = communicationMediaMetadata(media)
    return width && height ? Math.max(0.4, Math.min(2.5, width / height)) : media.kind === "sticker" ? 1 : 4 / 3
}

export function communicationPreviewUrl(url: string) {
    const [path] = url.split("#")
    return `${path}${path.includes("?") ? "&" : "?"}preview=1`
}

export const COMMUNICATION_PREVIEW_SUFFIX = ".preview-v1.webp"
