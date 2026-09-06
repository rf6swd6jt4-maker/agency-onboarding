import type { CommunicationAttachment } from "@/lib/communications/types"

export const MAX_NATIVE_ATTACHMENT_SIZE = 100 * 1024 * 1024

const EXTENSION_TYPES: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", avif: "image/avif", bmp: "image/bmp",
    heic: "image/heic", heif: "image/heif", tif: "image/tiff", tiff: "image/tiff", svg: "image/svg+xml",
    mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", qt: "video/quicktime", webm: "video/webm",
    mkv: "video/x-matroska", avi: "video/x-msvideo", wmv: "video/x-ms-wmv", mpg: "video/mpeg", mpeg: "video/mpeg",
    ogv: "video/ogg", "3gp": "video/3gpp", "3g2": "video/3gpp2", mts: "video/mp2t", m2ts: "video/mp2t", flv: "video/x-flv",
    mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", flac: "audio/flac", ogg: "audio/ogg", opus: "audio/ogg", aiff: "audio/aiff",
    pdf: "application/pdf", txt: "text/plain", csv: "text/csv", md: "text/markdown", json: "application/json",
    zip: "application/zip", "7z": "application/x-7z-compressed", rar: "application/vnd.rar", gz: "application/gzip",
    doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}
const MIME_ALIASES: Record<string, string> = {
    "image/jpg": "image/jpeg", "video/mov": "video/quicktime", "video/x-quicktime": "video/quicktime",
    "video/x-m4v": "video/mp4", "audio/x-m4a": "audio/mp4", "audio/x-wav": "audio/wav",
}
const PREVIEW_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif", "image/bmp"])

export function nativeAttachmentExtension(name: string) {
    return name.split(/[\\/]/).pop()?.match(/\.([a-z0-9][a-z0-9_+-]{0,19})$/i)?.[1].toLowerCase() ?? ""
}

export function nativeAttachmentFileName(name: string) {
    const cleaned = (name.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu, "").trim()
    if (cleaned.length <= 180) return cleaned
    const extension = nativeAttachmentExtension(cleaned)
    return extension ? `${cleaned.slice(0, 179 - extension.length)}.${extension}` : cleaned.slice(0, 180)
}

export function nativeAttachmentMimeType(type: string, name = "") {
    const normalized = type.toLowerCase().split(";", 1)[0].trim()
    if (!normalized || ["application/octet-stream", "binary/octet-stream", "application/x-empty"].includes(normalized)) {
        const extension = nativeAttachmentExtension(name)
        return Object.hasOwn(EXTENSION_TYPES, extension) ? EXTENSION_TYPES[extension] : "application/octet-stream"
    }
    if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(normalized) || normalized.length > 200) return "application/octet-stream"
    return MIME_ALIASES[normalized] ?? normalized
}

export function nativeAttachmentKind(type: string): Exclude<CommunicationAttachment["kind"], "sticker"> {
    const mimeType = nativeAttachmentMimeType(type)
    if (PREVIEW_IMAGE_TYPES.has(mimeType)) return "image"
    if (mimeType.startsWith("video/")) return "video"
    if (mimeType.startsWith("audio/")) return "audio"
    return "document"
}

export function validateNativeAttachmentFile(file: { name: string; size: number; type: string }) {
    const fileName = nativeAttachmentFileName(file.name)
    if (!fileName || !Number.isSafeInteger(file.size) || file.size <= 0) return { error: "Choose a non-empty attachment." } as const
    if (file.size > MAX_NATIVE_ATTACHMENT_SIZE) return { error: "Team chat files can be up to 100MB." } as const
    const mimeType = nativeAttachmentMimeType(file.type, fileName)
    return { kind: nativeAttachmentKind(mimeType), mimeType, fileName } as const
}

export function nativeAttachmentTypeLabel(attachment: Pick<CommunicationAttachment, "fileName" | "mimeType">) {
    const extension = nativeAttachmentExtension(attachment.fileName)
    return extension ? `${extension.toUpperCase()} file` : attachment.mimeType === "application/octet-stream" ? "File" : attachment.mimeType
}

export function nativeAttachmentSizeLabel(size: number | null) {
    if (!size) return ""
    return size >= 1024 * 1024 ? `${Number((size / 1024 / 1024).toFixed(1))} MB` : `${Math.max(1, Math.round(size / 1024))} KB`
}

// Native files are untrusted content. Only passive media may render inline on the app origin.
export function nativeAttachmentDeliveryHeaders(mimeType: string, fileName: string, download: boolean) {
    const contentType = nativeAttachmentMimeType(mimeType)
    const isFile = nativeAttachmentKind(contentType) === "document"
    const name = nativeAttachmentFileName(fileName) || "attachment"
    const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, "_")
    const encodedName = encodeURIComponent(name.toWellFormed()).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
    return {
        "Content-Type": isFile ? "application/octet-stream" : contentType,
        "Content-Disposition": `${download || isFile ? "attachment" : "inline"}; filename="${fallback}"; filename*=UTF-8''${encodedName}`,
        "X-Content-Type-Options": "nosniff",
        ...(isFile ? { "Content-Security-Policy": "sandbox; default-src 'none'" } : {}),
    }
}
