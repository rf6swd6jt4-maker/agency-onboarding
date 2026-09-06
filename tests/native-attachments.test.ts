import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import {
    MAX_NATIVE_ATTACHMENT_SIZE,
    nativeAttachmentDeliveryHeaders,
    nativeAttachmentFileName,
    nativeAttachmentKind,
    nativeAttachmentMimeType,
    nativeAttachmentSizeLabel,
    nativeAttachmentTypeLabel,
    validateNativeAttachmentFile,
} from "../lib/communications/native-attachments.ts"

test("team attachments accept video containers even when the picker omits their MIME type", () => {
    for (const [extension, mimeType] of Object.entries({ MOV: "video/quicktime", m4v: "video/mp4", webm: "video/webm", mkv: "video/x-matroska", avi: "video/x-msvideo", wmv: "video/x-ms-wmv", mts: "video/mp2t", "3gp": "video/3gpp" })) {
        for (const type of ["", "application/octet-stream", mimeType]) {
            assert.deepEqual(validateNativeAttachmentFile({ name: `Original Clip.${extension}`, type, size: 30 * 1024 * 1024 }), {
                kind: "video", mimeType, fileName: `Original Clip.${extension}`,
            })
        }
    }
    assert.equal(nativeAttachmentMimeType(" VIDEO/X-M4V; codecs=avc1 "), "video/mp4")
})

test("team attachments accept niche files without an extension allowlist", () => {
    for (const name of ["Design.psd", "Drawing.dwg", "Scene.blend", "Project.prproj", "Archive.7z", "Camera.RAW", "Database.sqlite", "Unknown.niche-format", "README"]) {
        const result = validateNativeAttachmentFile({ name, size: 1000, type: "" })
        assert.equal("error" in result, false, name)
        assert.equal(result.kind, "document", name)
        assert.equal(result.fileName, name)
    }
    assert.equal(nativeAttachmentMimeType("application/x-my-project"), "application/x-my-project")
    assert.equal(nativeAttachmentMimeType("image/png\r\nx-injected: true"), "application/octet-stream")
    assert.equal(nativeAttachmentMimeType("application/octet-stream", "test.constructor"), "application/octet-stream")
})

test("team files use a consistent 100MB limit and reject invalid sizes", () => {
    for (const type of ["image/png", "video/quicktime", "audio/flac", "application/octet-stream"]) {
        assert.equal("error" in validateNativeAttachmentFile({ name: "attachment", type, size: MAX_NATIVE_ATTACHMENT_SIZE }), false)
        assert.match(validateNativeAttachmentFile({ name: "attachment", type, size: MAX_NATIVE_ATTACHMENT_SIZE + 1 }).error ?? "", /100MB/)
    }
    for (const size of [0, -1, NaN, Infinity, 0.5]) assert.match(validateNativeAttachmentFile({ name: "file", type: "", size }).error ?? "", /non-empty/)
    assert.match(validateNativeAttachmentFile({ name: "\u0000", type: "", size: 1 }).error ?? "", /non-empty/)
})

test("ordinary WebP and GIF uploads are images, while active and specialist images use file cards", () => {
    for (const type of ["image/webp", "image/gif", "image/avif", "image/jpeg"]) assert.equal(nativeAttachmentKind(type), "image")
    for (const type of ["image/svg+xml", "image/heic", "image/tiff", "text/html"]) assert.equal(nativeAttachmentKind(type), "document")
    assert.equal(nativeAttachmentKind("audio/flac"), "audio")
})

test("native filenames retain their case, spaces, Unicode and extension", () => {
    assert.equal(nativeAttachmentFileName("My Final Design – Łódź.PSD"), "My Final Design – Łódź.PSD")
    assert.equal(nativeAttachmentFileName("C:\\fakepath\\My Clip.MOV"), "My Clip.MOV")
    assert.equal(nativeAttachmentFileName("../../test\u202efile\r\n.psd"), "testfile.psd")
    const longName = nativeAttachmentFileName(`${"a".repeat(190)}.prproj`)
    assert.equal(longName.length, 180)
    assert.ok(longName.endsWith(".prproj"))
    assert.equal(nativeAttachmentTypeLabel({ fileName: "Design.PSD", mimeType: "application/octet-stream" }), "PSD file")
    assert.equal(nativeAttachmentSizeLabel(30 * 1024 * 1024), "30 MB")
})

test("native file delivery cannot execute HTML, SVG or unknown content on the app origin", () => {
    for (const mimeType of ["text/html", "application/xhtml+xml", "image/svg+xml", "application/javascript", "application/x-custom", "application/pdf"]) {
        const headers = nativeAttachmentDeliveryHeaders(mimeType, 'My "File" – 文档.svg', false)
        assert.equal(headers["Content-Type"], "application/octet-stream")
        assert.ok(headers["Content-Disposition"].startsWith("attachment;"))
        assert.ok(headers["Content-Disposition"].includes("filename*=UTF-8''"))
        assert.equal(headers["X-Content-Type-Options"], "nosniff")
        assert.match(headers["Content-Security-Policy"] ?? "", /sandbox/)
        assert.doesNotThrow(() => new Headers(headers))
    }
    assert.match(nativeAttachmentDeliveryHeaders("video/quicktime", "Clip.MOV", false)["Content-Disposition"], /^inline;/)
    assert.match(nativeAttachmentDeliveryHeaders("video/quicktime", "Clip.MOV", true)["Content-Disposition"], /^attachment;/)
    assert.equal(nativeAttachmentDeliveryHeaders("video/quicktime", "Clip.MOV", false)["Content-Type"], "video/quicktime")
    assert.doesNotThrow(() => new Headers(nativeAttachmentDeliveryHeaders("text/html", "\ud800\r\n.html", false)))
})

test("native preparation and stored-file verification both use the broader rules while client uploads retain provider rules", async () => {
    const source = await readFile("lib/onboarding/uploads.ts", "utf8")
    const nativeUpload = source.slice(source.indexOf("export async function createSignedNativeMessageUpload"), source.indexOf("export async function inspectStoredCommunicationSticker"))
    assert.match(nativeUpload, /validateNativeAttachmentFile\(file\)/)
    assert.match(nativeUpload, /nativeAttachmentKind\(contentType\)/)
    assert.match(nativeUpload, /size > MAX_NATIVE_ATTACHMENT_SIZE/)
    assert.match(nativeUpload, /customerEncryptionInput\(customerKey\)/)
    assert.match(nativeUpload, /input\.storagePath\.startsWith\(prefix\)/)
    assert.doesNotMatch(nativeUpload, /validateCommunicationAttachmentFile|communicationAttachmentLimit/)
    const clientUpload = source.slice(source.indexOf("export async function createSignedClientMessageUpload"), source.indexOf("export async function createSignedNativeMessageUpload"))
    assert.match(clientUpload, /validateCommunicationAttachmentFile\(file\)/)
})
