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

test("received WebP stickers can be normalized into the outbound tray format", async () => {
    const source = await sharp({ create: { width: 900, height: 300, channels: 4, background: { r: 12, g: 18, b: 24, alpha: 1 } } })
        .webp({ quality: 95 })
        .toBuffer()
    const converted = await convertCommunicationStickerImage({ name: "received.webp", size: source.byteLength, type: "image/webp", bytes: new Uint8Array(source) })
    const metadata = await sharp(converted.bytes).metadata()
    assert.equal(metadata.format, "webp")
    assert.equal(metadata.width, 512)
    assert.equal(metadata.height, 512)
    assert.ok(converted.bytes.byteLength <= 100 * 1024)
})

test("inbound WhatsApp stickers render as bubbleless sticker attachments", () => {
    const attachment = communicationAttachmentFromRawPayload({ bridge_media: { type: "sticker", fileName: "client.webp", mimeType: "image/webp", storagePath: "workspace/client-messages/client.webp" } })
    assert.equal(attachment?.kind, "sticker")
})

test("inbound WhatsApp audio renders as an inline voice note", () => {
    const attachment = communicationAttachmentFromRawPayload({ bridge_media: { type: "audio", fileName: "voice-note.ogg", mimeType: "audio/ogg", storagePath: "workspace/client-messages/voice-note.ogg" } })
    assert.equal(attachment?.kind, "audio")
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
    assert.match(stickers, /prepareStoredCommunicationSticker/)
    assert.match(stickers, /alreadySaved: true/)
    assert.match(meta, /type: "reaction"/)
    assert.match(meta, /type: "sticker"/)
    assert.match(webhook, /handleInboundReaction/)
    assert.match(workspace, /onTouchMove/)
    assert.match(workspace, /translate3d\(\$\{swipeOffset\}px,0,0\)/)
    assert.match(workspace, /data-message-interaction/)
    assert.match(workspace, /bg-gradient-to-r from-white\/20/)
    assert.match(workspace, /MessageMediaLightbox/)
    assert.match(workspace, /Type or paste any emoji/)
    assert.match(workspace, /JPEG and PNG images are converted automatically/)
    assert.match(workspace, /Save sticker/)
    assert.match(workspace, /messageId: message\.id/)
})

test("message interactions keep the approved mobile and profile parity", async () => {
    const [clients, team, page, types, icons, shell] = await Promise.all([
        readFile("components/communications/CommunicationsWorkspace.tsx", "utf8"),
        readFile("components/communications/TeamCommunicationsWorkspace.tsx", "utf8"),
        readFile("app/[workspaceSlug]/communications/page.tsx", "utf8"),
        readFile("lib/communications/types.ts", "utf8"),
        readFile("components/communications/MessageInteractionIcons.tsx", "utf8"),
        readFile("components/workspace/WorkspaceTopBarClient.tsx", "utf8"),
    ])
    assert.match(clients, /data-message-action-popup/)
    assert.match(team, /data-message-action-popup/)
    assert.match(clients, /window\.parent\.document/)
    assert.match(team, /window\.parent\.document/)
    assert.match(team, /Delete this message\? This cannot be undone\./)
    assert.match(team, /selected\.kind === "team" \? <button/)
    assert.match(team, /!own && selected\.kind === "team" \? <button/)
    assert.match(team, /NativeDeliveryTicks/)
    assert.match(team, /read=\{readers\.length > 0\}/)
    assert.match(clients, /className="pointer-events-none absolute inset-x-0 top-2 truncate/)
    assert.match(clients, /selected\.canSend \? `Message \$\{selected\.title\}`/)
    assert.match(team, /className="pointer-events-none absolute inset-x-0 top-2 truncate/)
    assert.match(team, /selected\.canWrite \? `Message \$\{selected\.title\}`/)
    assert.match(clients, /<SquarePill tone="yellow" className="!min-h-5/)
    assert.match(page, /isTest: relationship\.source_metadata\.is_test === true/)
    assert.match(types, /isTest: boolean/)
    assert.match(icons, /function DoubleDeliveryCheckIcon/)
    assert.match(shell, /onClick=\{\(\) => onOpenProfile\(member\.id\)\}/)
    assert.match(clients, /-inset-x-3 inset-y-0/)
    assert.match(team, /-inset-x-3 inset-y-0/)
    assert.doesNotMatch(clients, /actionTop/)
    assert.doesNotMatch(team, /actionTop/)
    assert.match(clients, /VoiceNotePlayer/)
    assert.match(team, /VoiceNotePlayer/)
    assert.match(team, /isSticker \? "mb-1 w-fit rounded-full bg-neutral-950\/80 px-2 py-0\.5" : "mb-0\.5"/)
    assert.match(team, /min-h-4 w-4 min-w-4 max-w-4 shrink-0 aspect-square/)
    assert.match(team, /Shared across client and team chats\./)
    assert.match(team, /attachment\.kind === "sticker"/)
    assert.match(team, /isSticker && messageReactions\.length/)
})
