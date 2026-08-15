import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
    communicationAttachmentFromRawPayload,
    validateCommunicationAttachmentFile,
} from "../lib/communications/attachments.ts"

test("communication attachments enforce Meta media formats and limits", () => {
    assert.deepEqual(validateCommunicationAttachmentFile({ name: "photo.jpg", size: 1_000, type: "image/jpeg" }), { kind: "image" })
    assert.deepEqual(validateCommunicationAttachmentFile({ name: "brief.pdf", size: 1_000, type: "application/pdf" }), { kind: "document" })
    assert.match(validateCommunicationAttachmentFile({ name: "photo.webp", size: 1_000, type: "image/webp" }).error ?? "", /JPEG/)
    assert.match(validateCommunicationAttachmentFile({ name: "huge.png", size: 6 * 1024 * 1024, type: "image/png" }).error ?? "", /5MB/)
})

test("stored WhatsApp media becomes a stable authenticated chat attachment", () => {
    assert.deepEqual(communicationAttachmentFromRawPayload({
        bridge_media: {
            type: "image",
            fileName: "client-photo.jpg",
            mimeType: "image/jpeg",
            storagePath: "workspace/relationships/relationship/client-messages/photo.jpg",
        },
    }), {
        kind: "image",
        fileName: "client-photo.jpg",
        mimeType: "image/jpeg",
        size: null,
        storagePath: "workspace/relationships/relationship/client-messages/photo.jpg",
        url: "/api/client-messages/media/workspace/relationships/relationship/client-messages/photo.jpg",
    })
})

test("Communications uploads to R2 and sends verified media through Meta", async () => {
    const [uploadRoute, messageRoute, meta, workspace, mediaRoute] = await Promise.all([
        readFile("app/api/workspaces/[workspaceSlug]/communications/attachments/route.ts", "utf8"),
        readFile("app/api/workspaces/[workspaceSlug]/communications/messages/route.ts", "utf8"),
        readFile("lib/client-messages/meta-whatsapp.ts", "utf8"),
        readFile("components/communications/CommunicationsWorkspace.tsx", "utf8"),
        readFile("app/api/client-messages/media/[...path]/route.ts", "utf8"),
    ])
    assert.match(uploadRoute, /createSignedClientMessageUpload/)
    assert.match(uploadRoute, /ensurePlatformDirectUploads/)
    assert.match(messageRoute, /verifyClientMessageUpload/)
    assert.match(messageRoute, /sendMetaWhatsAppMedia/)
    assert.match(meta, /\[kind\]: media/)
    assert.match(meta, /context: replyToMessageId/)
    assert.match(workspace, /Attach image or file/)
    assert.match(workspace, /MessageAttachment/)
    assert.match(mediaRoute, /workspace_memberships/)
})
