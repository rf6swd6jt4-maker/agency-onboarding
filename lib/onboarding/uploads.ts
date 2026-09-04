import { createHash, randomUUID } from "crypto"
import sharp from "sharp"
import {
    DeleteObjectsCommand,
    GetObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { recordAdminActivity } from "@/lib/admin/activity"
import { communicationAttachmentKind, communicationAttachmentLimit, validateCommunicationAttachmentFile } from "@/lib/communications/attachments"
import { convertCommunicationStickerImage } from "@/lib/communications/stickers"
import { validateClientLogoSvg } from "@/lib/client-branding/svg"
import { getRequiredEnv } from "@/lib/env"
import { createCommunicationFileKey, createInboundCommunicationFileKey } from "@/lib/communications/encryption"
import {
    getUploadKind,
    MAX_ONBOARDING_UPLOAD_SIZE,
    StoredUpload,
} from "@/lib/onboarding/forms"

export { MAX_ONBOARDING_UPLOAD_SIZE } from "@/lib/onboarding/forms"

const R2_SIGNED_URL_TTL_SECONDS = 60 * 60
const R2_BRIDGE_MEDIA_SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60
const R2_UPLOAD_URL_TTL_SECONDS = 15 * 60
const MAX_SERVICE_THUMBNAIL_SIZE = 10 * 1024 * 1024

function getR2Client() {
    return new S3Client({
        region: "auto",
        endpoint: `https://${getRequiredEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: getRequiredEnv("R2_ACCESS_KEY_ID"),
            secretAccessKey: getRequiredEnv("R2_SECRET_ACCESS_KEY"),
        },
    })
}

function getR2BucketName() {
    return getRequiredEnv("R2_BUCKET_NAME")
}

function validatedCustomerEncryptionKey(keyBase64: string) {
    const bytes = Buffer.from(keyBase64, "base64")
    if (keyBase64.length !== 44 || /\s/u.test(keyBase64) || bytes.byteLength !== 32 || bytes.toString("base64") !== keyBase64) {
        throw new Error("The attachment encryption key is invalid.")
    }
    return { keyBase64, keyMd5: createHash("md5").update(bytes).digest("base64") }
}

function customerEncryptionHeaders(keyBase64: string) {
    const key = validatedCustomerEncryptionKey(keyBase64)
    return {
        "x-amz-server-side-encryption-customer-algorithm": "AES256",
        "x-amz-server-side-encryption-customer-key": key.keyBase64,
        "x-amz-server-side-encryption-customer-key-MD5": key.keyMd5,
    }
}

function customerEncryptionInput(keyBase64: string) {
    const key = validatedCustomerEncryptionKey(keyBase64)
    return {
        SSECustomerAlgorithm: "AES256",
        SSECustomerKey: key.keyBase64,
        SSECustomerKeyMD5: key.keyMd5,
    }
}

function sanitizeFileName(name: string) {
    return name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 120)
}

function getPublicR2Url(path: string) {
    const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL?.replace(/\/+$/g, "")

    if (!publicBaseUrl) return null

    // Legacy media.scaylup.com URLs are no longer part of the platform. When
    // an old environment value remains in place, use a private R2 signed URL
    // instead of emitting broken image links for existing workspace assets.
    try {
        const hostname = new URL(publicBaseUrl).hostname.toLowerCase()
        if (hostname === "scaylup.com" || hostname.endsWith(".scaylup.com")) return null
    } catch {
        return null
    }

    const encodedPath = path
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/")

    return `${publicBaseUrl}/${encodedPath}`
}

export function createServiceThumbnailPublicUrl(path: string | null | undefined) {
    return path ? getPublicR2Url(path) : null
}

function encodeStoragePath(path: string) {
    return path
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/")
}

export function createClientMessageMediaUrl(
    path: string,
    appBaseUrl = process.env.NEXT_PUBLIC_SITE_URL
) {
    const siteUrl = appBaseUrl?.replace(/\/+$/g, "")

    if (!siteUrl) return null

    return `${siteUrl}/api/client-messages/media/${encodeStoragePath(path)}`
}

export async function createSignedOnboardingUpload(
    workspaceId: string,
    clientId: string,
    stepKey: string,
    file: {
        name: string
        size: number
        type: string
    }
) {
    if (file.size > MAX_ONBOARDING_UPLOAD_SIZE) {
        throw new Error(`${file.name} is larger than the 500MB upload limit.`)
    }

    const fileName = sanitizeFileName(file.name) || "upload"
    const path = `${workspaceId}/${clientId}/${stepKey}/${randomUUID()}-${fileName}`
    const contentType = file.type || "application/octet-stream"

    const uploadUrl = await getSignedUrl(
        getR2Client(),
        new PutObjectCommand({
            Bucket: getR2BucketName(),
            Key: path,
            ContentType: contentType,
        }),
        {
            expiresIn: R2_UPLOAD_URL_TTL_SECONDS,
        }
    )

    const storedUpload: StoredUpload = {
        name: file.name,
        path,
        size: file.size,
        type: contentType,
        kind: getUploadKind(contentType),
        provider: "r2",
    }

    return {
        uploadUrl,
        storedUpload,
    }
}

export async function createSignedRelationshipOnboardingUpload(
    workspaceId: string,
    relationshipId: string,
    sessionId: string,
    stepKey: string,
    file: {
        name: string
        size: number
        type: string
    }
) {
    if (file.size > MAX_ONBOARDING_UPLOAD_SIZE) {
        throw new Error(`${file.name} is larger than the 500MB upload limit.`)
    }

    const fileName = sanitizeFileName(file.name) || "upload"
    const path = `${workspaceId}/onboarding/${relationshipId}/${sessionId}/${stepKey}/${randomUUID()}-${fileName}`
    const contentType = file.type || "application/octet-stream"

    const uploadUrl = await getSignedUrl(
        getR2Client(),
        new PutObjectCommand({
            Bucket: getR2BucketName(),
            Key: path,
            ContentType: contentType,
        }),
        {
            expiresIn: R2_UPLOAD_URL_TTL_SECONDS,
        }
    )

    const storedUpload: StoredUpload = {
        name: file.name,
        path,
        size: file.size,
        type: contentType,
        kind: getUploadKind(contentType),
        provider: "r2",
    }

    return {
        uploadUrl,
        storedUpload,
    }
}

export async function createSignedAssetUpload(
    workspaceId: string,
    file: {
        name: string
        size: number
        type: string
    }
) {
    if (file.size > MAX_ONBOARDING_UPLOAD_SIZE) {
        throw new Error(`${file.name} is larger than the 500MB upload limit.`)
    }

    const fileName = sanitizeFileName(file.name) || "asset"
    const contentType = file.type || "application/octet-stream"
    const path = `${workspaceId}/assets/${randomUUID()}-${fileName}`
    const uploadUrl = await getSignedUrl(
        getR2Client(),
        new PutObjectCommand({
            Bucket: getR2BucketName(),
            Key: path,
            ContentType: contentType,
        }),
        {
            expiresIn: R2_UPLOAD_URL_TTL_SECONDS,
        }
    )

    const kind = contentType.startsWith("image/") || contentType.startsWith("video/") || contentType.startsWith("audio/")
        ? "media"
        : contentType.includes("pdf") ||
            contentType.includes("document") ||
            contentType.includes("spreadsheet") ||
            contentType.includes("presentation") ||
            fileName.endsWith(".pdf") ||
            fileName.endsWith(".doc") ||
            fileName.endsWith(".docx") ||
            fileName.endsWith(".xls") ||
            fileName.endsWith(".xlsx") ||
            fileName.endsWith(".ppt") ||
            fileName.endsWith(".pptx")
            ? "document"
            : "file"

    return {
        uploadUrl,
        storedAsset: {
            name: file.name,
            path,
            size: file.size,
            type: contentType,
            kind,
            provider: "r2" as const,
        },
    }
}

export async function createSignedServiceThumbnailUpload(
    workspaceId: string,
    file: {
        name: string
        size: number
        type: string
    }
) {
    if (!file.name.trim() || !Number.isSafeInteger(file.size) || file.size <= 0) {
        throw new Error("Choose a non-empty image file.")
    }
    if (!file.type.startsWith("image/")) {
        throw new Error("Service thumbnails must be image files.")
    }
    if (file.size > MAX_SERVICE_THUMBNAIL_SIZE) {
        throw new Error(`${file.name} is larger than the 10MB thumbnail limit.`)
    }

    const fileName = sanitizeFileName(file.name) || "service-thumbnail"
    const path = `${workspaceId}/service-thumbnails/${randomUUID()}-${fileName}`
    const uploadUrl = await getSignedUrl(
        getR2Client(),
        new PutObjectCommand({
            Bucket: getR2BucketName(),
            Key: path,
            ContentType: file.type,
        }),
        { expiresIn: R2_UPLOAD_URL_TTL_SECONDS }
    )

    return {
        uploadUrl,
        thumbnail: {
            name: file.name,
            path,
            size: file.size,
            type: file.type,
        },
        previewUrl: await createPrivateUploadSignedUrl(path),
    }
}

export async function createSignedBuilderMediaUpload(
    workspaceId: string,
    moduleId: string,
    revisionId: string,
    file: {
        name: string
        size: number
        type: string
    }
) {
    if (!file.name.trim()) {
        throw new Error("Builder video uploads need a file name.")
    }
    if (!Number.isSafeInteger(file.size) || file.size <= 0) {
        throw new Error("Builder video uploads must contain a non-empty file.")
    }
    if (file.size > MAX_ONBOARDING_UPLOAD_SIZE) {
        throw new Error(`${file.name} is larger than the 500MB upload limit.`)
    }
    if (!file.type.startsWith("video/")) {
        throw new Error("Builder video uploads must be a video file.")
    }

    const fileName = sanitizeFileName(file.name) || "module-video"
    const contentType = file.type
    const path = `${workspaceId}/onboarding-builder/${moduleId}/${revisionId}/${randomUUID()}-${fileName}`
    const uploadUrl = await getSignedUrl(
        getR2Client(),
        new PutObjectCommand({
            Bucket: getR2BucketName(),
            Key: path,
            ContentType: contentType,
        }),
        { expiresIn: R2_UPLOAD_URL_TTL_SECONDS }
    )
    const previewUrl = await createPrivateUploadSignedUrl(path)

    return {
        uploadUrl,
        previewUrl,
        storedVideo: {
            name: file.name,
            path,
            size: file.size,
            type: contentType,
            provider: "r2" as const,
        },
    }
}

export async function storeWorkspaceImage(
    workspaceId: string,
    file: { name: string; size: number; type: string; bytes: Uint8Array }
) {
    if (file.size > 10 * 1024 * 1024) throw new Error("Workspace images must be 10MB or smaller.")
    const bytes = file.bytes
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    const isGif = bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38
    const isWebp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    const brand = String.fromCharCode(...bytes.slice(8, 12))
    const isAvif = bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70 && (brand === "avif" || brand === "avis")
    const isHeic = bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70 && ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)
    if (!isPng && !isJpeg && !isGif && !isWebp && !isAvif && !isHeic) throw new Error("Images must be PNG, JPEG, GIF, WebP, AVIF, or HEIC.")
    const fileName = sanitizeFileName(file.name) || "dashboard-banner"
    const path = `${workspaceId}/workspace/${randomUUID()}-${fileName}`
    const contentType = isPng ? "image/png" : isJpeg ? "image/jpeg" : isGif ? "image/gif" : isWebp ? "image/webp" : isAvif ? "image/avif" : "image/heic"
    await getR2Client().send(new PutObjectCommand({ Bucket: getR2BucketName(), Key: path, Body: bytes, ContentType: contentType }))
    return path
}

export async function storeClientBrandLogo(
    workspaceId: string,
    file: { name: string; size: number; type: string; bytes: Uint8Array }
) {
    const source = validateClientLogoSvg(file.bytes)
    const metadata = await sharp(Buffer.from(source)).metadata()
    if (metadata.format !== "svg") throw new Error("Agency logos must be valid SVG files.")
    const fileName = `${sanitizeFileName(file.name.replace(/\.svg$/iu, "")) || "agency-logo"}.svg`
    const path = `${workspaceId}/client-branding/logo/${randomUUID()}-${fileName}`
    await getR2Client().send(new PutObjectCommand({
        Bucket: getR2BucketName(),
        Key: path,
        Body: source,
        ContentType: "image/svg+xml",
    }))
    return path
}

export async function storeClientBrandFavicon(
    workspaceId: string,
    file: { name: string; size: number; type: string; bytes: Uint8Array }
) {
    if (!file.size) throw new Error("Choose a non-empty favicon image.")
    if (file.size > 5 * 1024 * 1024) throw new Error("Agency favicons must be 5MB or smaller.")
    const metadata = await sharp(file.bytes).metadata()
    if (!metadata.format || !["png", "jpeg", "webp"].includes(metadata.format)) {
        throw new Error("Favicons must be PNG, JPEG, or WebP images.")
    }
    const image = await sharp(file.bytes)
        .rotate()
        .resize(512, 512, {
            fit: "contain",
            background: { r: 0, g: 0, b: 0, alpha: 0 },
            withoutEnlargement: true,
        })
        .png()
        .toBuffer()
    const path = `${workspaceId}/client-branding/favicon/${randomUUID()}-favicon.png`
    await getR2Client().send(new PutObjectCommand({
        Bucket: getR2BucketName(),
        Key: path,
        Body: image,
        ContentType: "image/png",
    }))
    return path
}

export async function storeProfileAvatar(userId: string, file: { name: string; size: number; type: string; bytes: Uint8Array }) {
    const image = await sharp(file.bytes)
        .rotate()
        .resize(400, 400, { fit: "cover", position: "centre", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer()
    const fileName = `${file.name.replace(/\.[^.]+$/, "") || "avatar"}.webp`

    return storeWorkspaceImage(`profiles/${userId}`, {
        name: fileName,
        size: image.byteLength,
        type: "image/webp",
        bytes: new Uint8Array(image),
    })
}

export async function createUploadSignedUrl(
    path: string,
    expiresIn = R2_SIGNED_URL_TTL_SECONDS
) {
    const publicUrl = getPublicR2Url(path)

    if (publicUrl) return publicUrl

    return getSignedUrl(
        getR2Client(),
        new GetObjectCommand({
            Bucket: getR2BucketName(),
            Key: path,
        }),
        {
            expiresIn,
        }
    )
}

export async function createPrivateUploadSignedUrl(
    path: string,
    expiresIn = R2_SIGNED_URL_TTL_SECONDS
) {
    return getSignedUrl(
        getR2Client(),
        new GetObjectCommand({
            Bucket: getR2BucketName(),
            Key: path,
        }),
        {
            expiresIn,
        }
    )
}

export async function createEncryptedPrivateUploadSignedRequest(path: string, customerKey: string, expiresIn = R2_SIGNED_URL_TTL_SECONDS) {
    return {
        url: await getSignedUrl(
            getR2Client(),
            new GetObjectCommand({ Bucket: getR2BucketName(), Key: path, ...customerEncryptionInput(customerKey) }),
            { expiresIn }
        ),
        headers: customerEncryptionHeaders(customerKey),
    }
}

export async function downloadOnboardingUpload(path: string) {
    const response = await getR2Client().send(
        new GetObjectCommand({
            Bucket: getR2BucketName(),
            Key: path,
        })
    )

    if (!response.Body) {
        throw new Error(`Could not download upload: ${path}`)
    }

    const body = response.Body as {
        transformToByteArray?: () => Promise<Uint8Array>
    }

    if (!body.transformToByteArray) {
        throw new Error(`Upload body is not readable: ${path}`)
    }

    return {
        bytes: await body.transformToByteArray(),
        contentType: response.ContentType ?? "application/octet-stream",
    }
}

export async function createUploadSignedUrls(paths: string[]) {
    if (paths.length === 0) {
        return new Map<string, string>()
    }

    const entries = await Promise.all(
        paths.map(async (path) => [path, await createUploadSignedUrl(path)] as const)
    )

    return new Map(entries)
}

export async function deleteOnboardingUploads(paths: string[]) {
    const uniquePaths = [...new Set(paths)].filter(Boolean)

    if (uniquePaths.length === 0) {
        return
    }

    for (let index = 0; index < uniquePaths.length; index += 1000) {
        const chunk = uniquePaths.slice(index, index + 1000)

        await getR2Client().send(
            new DeleteObjectsCommand({
                Bucket: getR2BucketName(),
                Delete: {
                    Objects: chunk.map((path) => ({ Key: path })),
                    Quiet: true,
                },
            })
        )
    }
}

export async function storeClientMessageMedia({
    clientId,
    relationshipId,
    workspaceId,
    mediaId,
    fileName,
    contentType,
    body,
    appBaseUrl,
    encrypt = true,
}: {
    clientId: string | null
    relationshipId?: string | null
    workspaceId?: string
    mediaId: string
    fileName: string
    contentType: string
    body: Uint8Array
    appBaseUrl?: string
    encrypt?: boolean
}) {
    const safeFileName = sanitizeFileName(fileName) || "whatsapp-media"
    const ownerPath = clientId ?? (relationshipId ? `relationships/${relationshipId}` : "unmatched")
    const encryptMedia = Boolean(encrypt && workspaceId && relationshipId)
    const path = `${workspaceId ? `${workspaceId}/` : ""}${ownerPath}/client-messages/${randomUUID()}${encryptMedia ? ".enc" : `-${mediaId}-${safeFileName}`}`
    const customerKey = encryptMedia && workspaceId && relationshipId
        ? await createInboundCommunicationFileKey({ workspaceId, relationshipId, storagePath: path })
        : null

    await getR2Client().send(
        new PutObjectCommand({
            Bucket: getR2BucketName(),
            Key: path,
            Body: body,
            ContentType: contentType || "application/octet-stream",
            ...(customerKey ? customerEncryptionInput(customerKey) : {}),
        })
    )

    if (workspaceId) await recordAdminActivity({ workspaceId, category: "communications", eventKey: "r2.media.stored", summary: "Client message media stored in R2", entityType: "client_message_media", entityId: mediaId, direction: "outbound", metadata: { client_id: clientId, relationship_id: relationshipId ?? null, content_type: contentType } })

    return {
        path,
        url:
            createClientMessageMediaUrl(path, appBaseUrl) ??
            (await createUploadSignedUrl(
                path,
                R2_BRIDGE_MEDIA_SIGNED_URL_TTL_SECONDS
            )),
    }
}

export async function createSignedClientMessageUpload(
    workspaceId: string,
    relationshipId: string,
    file: { name: string; size: number; type: string }
) {
    const validation = validateCommunicationAttachmentFile(file)
    if ("error" in validation) throw new Error(validation.error)
    const fileName = sanitizeFileName(file.name) || "attachment"
    const contentType = file.type.toLowerCase().split(";", 1)[0].trim()
    const path = `${workspaceId}/relationships/${relationshipId}/client-messages/${randomUUID()}.enc`
    const customerKey = await createCommunicationFileKey({ workspaceId, scopeKind: "client", scopeId: relationshipId, storagePath: path })
    const uploadUrl = await getSignedUrl(
        getR2Client(),
        new PutObjectCommand({
            Bucket: getR2BucketName(),
            Key: path,
            ContentType: contentType,
            ContentLength: file.size,
            ...customerEncryptionInput(customerKey),
        }),
        { expiresIn: R2_UPLOAD_URL_TTL_SECONDS }
    )
    return {
        uploadUrl,
        uploadHeaders: customerEncryptionHeaders(customerKey),
        attachment: {
            kind: validation.kind,
            fileName: fileName.slice(0, 180),
            mimeType: contentType,
            size: file.size,
            storagePath: path,
            url: createClientMessageMediaUrl(path) ?? `/api/client-messages/media/${encodeStoragePath(path)}`,
        },
    }
}

export async function verifyClientMessageUpload(input: {
    workspaceId: string
    relationshipId: string
    storagePath: string
    mimeType: string
    customerKey?: string | null
}) {
    const prefix = `${input.workspaceId}/relationships/${input.relationshipId}/client-messages/`
    if (!input.storagePath.startsWith(prefix) || input.storagePath.slice(prefix.length).includes("/")) {
        throw new Error("Invalid client message attachment path")
    }
    const response = await getR2Client().send(new HeadObjectCommand({
        Bucket: getR2BucketName(),
        Key: input.storagePath,
        ...(input.customerKey ? customerEncryptionInput(input.customerKey) : {}),
    }))
    const contentType = (response.ContentType ?? input.mimeType).toLowerCase().split(";", 1)[0].trim()
    const kind = communicationAttachmentKind(contentType)
    const size = response.ContentLength ?? 0
    if (!kind || size <= 0 || size > communicationAttachmentLimit(kind)) {
        throw new Error("The uploaded attachment is missing or unsupported")
    }
    return { kind, contentType, size }
}

export async function createSignedNativeMessageUpload(
    workspaceId: string,
    conversationId: string,
    file: { name: string; size: number; type: string }
) {
    const validation = validateCommunicationAttachmentFile(file)
    if ("error" in validation) throw new Error(validation.error)
    const fileName = sanitizeFileName(file.name) || "attachment"
    const contentType = file.type.toLowerCase().split(";", 1)[0].trim()
    const path = `${workspaceId}/communications/native/${conversationId}/${randomUUID()}.enc`
    const customerKey = await createCommunicationFileKey({ workspaceId, scopeKind: "native", scopeId: conversationId, storagePath: path })
    const uploadUrl = await getSignedUrl(
        getR2Client(),
        new PutObjectCommand({ Bucket: getR2BucketName(), Key: path, ContentType: contentType, ContentLength: file.size, ...customerEncryptionInput(customerKey) }),
        { expiresIn: R2_UPLOAD_URL_TTL_SECONDS }
    )
    return {
        uploadUrl,
        uploadHeaders: customerEncryptionHeaders(customerKey),
        attachment: {
            kind: validation.kind,
            fileName: fileName.slice(0, 180),
            mimeType: contentType,
            size: file.size,
            storagePath: path,
            url: createClientMessageMediaUrl(path) ?? `/api/client-messages/media/${encodeStoragePath(path)}`,
        },
    }
}

export async function verifyNativeMessageUpload(input: {
    workspaceId: string
    conversationId: string
    storagePath: string
    mimeType: string
    customerKey?: string | null
}) {
    const prefix = `${input.workspaceId}/communications/native/${input.conversationId}/`
    if (!input.storagePath.startsWith(prefix) || input.storagePath.slice(prefix.length).includes("/")) throw new Error("Invalid native message attachment path")
    const response = await getR2Client().send(new HeadObjectCommand({ Bucket: getR2BucketName(), Key: input.storagePath, ...(input.customerKey ? customerEncryptionInput(input.customerKey) : {}) }))
    const contentType = (response.ContentType ?? input.mimeType).toLowerCase().split(";", 1)[0].trim()
    const kind = communicationAttachmentKind(contentType)
    const size = response.ContentLength ?? 0
    if (!kind || kind === "sticker" || size <= 0 || size > communicationAttachmentLimit(kind)) throw new Error("The uploaded attachment is missing or unsupported")
    return { kind, contentType, size }
}

export async function inspectStoredCommunicationSticker(input: {
    workspaceId: string
    storagePath: string
    mimeType: string
}) {
    if (!input.storagePath.startsWith(`${input.workspaceId}/`)) {
        throw new Error("Invalid workspace sticker path")
    }
    const response = await getR2Client().send(new HeadObjectCommand({
        Bucket: getR2BucketName(),
        Key: input.storagePath,
    }))
    const storedContentType = (response.ContentType ?? "").toLowerCase().split(";", 1)[0].trim()
    const contentType = (!storedContentType || storedContentType === "application/octet-stream" ? input.mimeType : storedContentType).toLowerCase().split(";", 1)[0].trim()
    const kind = communicationAttachmentKind(contentType)
    const size = response.ContentLength ?? 0
    if (kind !== "sticker" || size <= 0 || size > communicationAttachmentLimit("sticker")) {
        throw new Error("This message does not contain a supported WhatsApp sticker.")
    }
    return { contentType, size }
}

export async function prepareStoredCommunicationSticker(input: {
    workspaceId: string
    storagePath: string
    fileName: string
    mimeType: string
}) {
    try {
        const inspected = await inspectStoredCommunicationSticker(input)
        return { ...inspected, storagePath: input.storagePath, fileName: input.fileName }
    } catch {
        // Client-originated stickers are allowed to exceed the outbound tray
        // format. Normalize them into a deterministic tray object instead of
        // weakening the 512px/100KB contract used when sending them again.
    }

    const sourceKey = createHash("sha256").update(input.storagePath).digest("hex").slice(0, 24)
    const storagePath = `${input.workspaceId}/communications/stickers/received-${sourceKey}.webp`
    try {
        const inspected = await inspectStoredCommunicationSticker({ ...input, storagePath, mimeType: "image/webp" })
        return { ...inspected, storagePath, fileName: input.fileName.replace(/\.[^.]+$/u, "") + ".webp" }
    } catch {
        // The deterministic normalized copy has not been created yet.
    }

    const source = await downloadOnboardingUpload(input.storagePath)
    const storedContentType = source.contentType.toLowerCase().split(";", 1)[0].trim()
    const contentType = (!storedContentType || storedContentType === "application/octet-stream" ? input.mimeType : storedContentType).toLowerCase().split(";", 1)[0].trim()
    const converted = await convertCommunicationStickerImage({
        name: input.fileName,
        size: source.bytes.byteLength,
        type: contentType,
        bytes: source.bytes,
    })
    await getR2Client().send(new PutObjectCommand({
        Bucket: getR2BucketName(),
        Key: storagePath,
        Body: converted.bytes,
        ContentType: "image/webp",
    }))
    return { contentType: "image/webp", size: converted.bytes.byteLength, storagePath, fileName: converted.fileName }
}

export async function storeCommunicationSticker(
    workspaceId: string,
    file: { name: string; size: number; type: string; bytes: Uint8Array }
) {
    const converted = await convertCommunicationStickerImage(file)
    const fileName = converted.fileName
    const path = `${workspaceId}/communications/stickers/${randomUUID()}-${fileName}`
    await getR2Client().send(new PutObjectCommand({
        Bucket: getR2BucketName(),
        Key: path,
        Body: converted.bytes,
        ContentType: "image/webp",
    }))
    return {
        fileName,
        storagePath: path,
        size: converted.bytes.byteLength,
        url: createClientMessageMediaUrl(path) ?? `/api/client-messages/media/${encodeStoragePath(path)}`,
    }
}
