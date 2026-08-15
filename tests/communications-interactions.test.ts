import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import sharp from "sharp"

import { communicationAttachmentFromRawPayload } from "../lib/communications/attachments.ts"
import { convertCommunicationStickerImage } from "../lib/communications/stickers.ts"

test("PNG sticker sources become transparent 512px WebP files under Meta's limit", async () => {
    const source = await sharp({ create: { width: 240, height: 120, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: Buffer.from('<svg width="240" height="120"><circle cx="120" cy="60" r="55" fill="#34d399"/></svg>') }])
        .png()
        .toBuffer()
    const converted = await convertCommunicationStickerImage({ name: "circle.png", size: source.byteLength, type: "image/png", bytes: new Uint8Array(source) })
    const metadata = await sharp(converted.bytes).metadata()
    assert.equal(converted.fileName, "circle.webp")
    assert.equal(metadata.format, "webp")
    assert.equal(metadata.width, 512)
    assert.equal(metadata.height, 512)
    assert.ok(metadata.hasAlpha)
    assert.ok(converted.bytes.byteLength <= 100 * 1024)
})

test("inbound WhatsApp stickers render as bubbleless sticker attachments", () => {
    const attachment = communicationAttachmentFromRawPayload({ bridge_media: { type: "sticker", fileName: "client.webp", mimeType: "image/webp", storagePath: "workspace/client-messages/client.webp" } })
    assert.equal(attachment?.kind, "sticker")
})

test("Communications interactions are durable and native to WhatsApp", async () => {
    const [migration, reactions, stickers, meta, webhook, workspace] = await Promise.all([
        readFile("supabase/migrations/20260815010000_communications_reactions_stickers.sql", "utf8"),
        readFile("app/api/workspaces/[workspaceSlug]/communications/reactions/route.ts", "utf8"),
        readFile("app/api/workspaces/[workspaceSlug]/communications/stickers/route.ts", "utf8"),
        readFile("lib/client-messages/meta-whatsapp.ts", "utf8"),
        readFile("app/api/client-messages/meta/whatsapp/route.ts", "utf8"),
        readFile("components/communications/CommunicationsWorkspace.tsx", "utf8"),
    ])
    assert.match(migration, /create table if not exists public\.communication_reactions/)
    assert.match(migration, /unique \(client_message_id, direction\)/)
    assert.match(migration, /create table if not exists public\.communication_stickers/)
    assert.match(migration, /alter publication supabase_realtime add table public\.communication_reactions/)
    assert.match(reactions, /sendMetaWhatsAppReaction/)
    assert.match(reactions, /Intl\.Segmenter/)
    assert.match(stickers, /storeCommunicationSticker/)
    assert.match(stickers, /saveStickerFromMessage/)
    assert.match(stickers, /communicationAttachmentFromRawPayload/)
    assert.match(stickers, /inspectStoredCommunicationSticker/)
    assert.match(stickers, /alreadySaved: true/)
    assert.match(meta, /type: "reaction"/)
    assert.match(meta, /type: "sticker"/)
    assert.match(webhook, /handleInboundReaction/)
    assert.match(workspace, /onTouchMove/)
    assert.match(workspace, /translateX\(\$\{swipeOffset\}px\)/)
    assert.match(workspace, /Type or paste any emoji/)
    assert.match(workspace, /JPEG and PNG images are converted automatically/)
    assert.match(workspace, /Save sticker/)
    assert.match(workspace, /messageId: message\.id/)
})
