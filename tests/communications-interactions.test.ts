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
    const [migration, reactions, stickers, meta, webhook, workspace, actions, pinMigration, pins] = await Promise.all([
        readFile("supabase/migrations/20260815010000_communications_reactions_stickers.sql", "utf8"),
        readFile("app/api/workspaces/[workspaceSlug]/communications/reactions/route.ts", "utf8"),
        readFile("app/api/workspaces/[workspaceSlug]/communications/stickers/route.ts", "utf8"),
        readFile("lib/client-messages/meta-whatsapp.ts", "utf8"),
        readFile("app/api/client-messages/meta/whatsapp/route.ts", "utf8"),
        readFile("components/communications/CommunicationsWorkspace.tsx", "utf8"),
        readFile("components/communications/MessageActionMenu.tsx", "utf8"),
        readFile("supabase/migrations/20260816203000_communication_message_pins.sql", "utf8"),
        readFile("app/api/workspaces/[workspaceSlug]/communications/pins/route.ts", "utf8"),
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
    assert.match(workspace, /onTouchCancel/)
    assert.match(workspace, /translate3d\(\$\{swipeOffset\}px,0,0\)/)
    assert.match(workspace, /data-message-interaction/)
    assert.match(workspace, /bg-gradient-to-r from-white\/20/)
    assert.match(workspace, /MessageMediaLightbox/)
    assert.match(actions, /Use device emoji picker/)
    assert.match(actions, /PrimaryMessageActions/)
    assert.match(actions, /Copy message/)
    assert.match(actions, /Pin message/)
    assert.match(actions, /React to message/)
    assert.doesNotMatch(actions, /EMOJI_CATALOGUE/)
    assert.match(pinMigration, /communication_pinned_message_id/)
    assert.match(pinMigration, /pinned_message_id/)
    assert.match(pins, /eq\("relationship_id", relationshipId\)/)
    assert.match(workspace, /JPEG and PNG images are converted automatically/)
    assert.match(workspace, /Save sticker/)
    assert.match(workspace, /messageId: message\.id/)
})

test("message interactions keep the approved mobile and profile parity", async () => {
    const [clients, team, composerScroll, page, panel, types, icons, shell, resizableColumns, jumpToLatest, globals, actions, pinnedBar] = await Promise.all([
        readFile("components/communications/CommunicationsWorkspace.tsx", "utf8"),
        readFile("components/communications/TeamCommunicationsWorkspace.tsx", "utf8"),
        readFile("components/communications/composer-scroll.ts", "utf8"),
        readFile("app/[workspaceSlug]/communications/page.tsx", "utf8"),
        readFile("components/communications/CommunicationsPanel.tsx", "utf8"),
        readFile("lib/communications/types.ts", "utf8"),
        readFile("components/communications/MessageInteractionIcons.tsx", "utf8"),
        readFile("components/workspace/WorkspaceTopBarClient.tsx", "utf8"),
        readFile("components/communications/ResizableConversationColumns.tsx", "utf8"),
        readFile("components/communications/JumpToLatestButton.tsx", "utf8"),
        readFile("app/globals.css", "utf8"),
        readFile("components/communications/MessageActionMenu.tsx", "utf8"),
        readFile("components/communications/PinnedMessageBar.tsx", "utf8"),
    ])
    assert.match(clients, /data-message-action-popup/)
    for (const source of [clients, team]) {
        assert.match(source, /touch-pan-y overflow-x-hidden overflow-y-auto overscroll-x-none overscroll-y-contain/)
        assert.match(source, /mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-2 lg:max-w-none/)
        assert.match(source, /<ResizableConversationColumns>/)
        assert.match(source, /onTouchCancel/)
        assert.match(source, /max-w-\[80%\]/)
        assert.match(source, /min-w-0 touch-pan-y cursor-pointer/)
        assert.doesNotMatch(source, /min-w-0 max-w-full touch-pan-y cursor-pointer/)
        assert.match(source, /scrollLeft !== 0\) event\.currentTarget\.scrollLeft = 0/)
        assert.match(source, /scrollTo\(\{ top: messagePaneRef\.current\.scrollHeight, left: 0 \}\)/)
        assert.match(source, /messagePaneIsAwayFromBottom\(event\.currentTarget\)/)
        assert.match(source, /behavior: "smooth"/)
        assert.match(source, /messagePaneCanShowNewMessage\(messagePaneRef\.current, followLatestRef\.current\)/)
        assert.match(source, /betelgeze-message-enter-right/)
        assert.match(source, /betelgeze-message-enter-left/)
        assert.match(source, /betelgeze-reaction-popup-enter/)
    }
    assert.match(team, /data-message-action-popup/)
    assert.match(panel, /window\.frameElement as HTMLElement \| null/)
    assert.match(panel, /viewport\?\.height \?\? viewportHost\.innerHeight/)
    assert.match(panel, /composerFocused \? Math\.max\(0, Math\.round\(layoutBottom - viewportBottom\)\) : 0/)
    assert.match(panel, /--communications-keyboard-inset/)
    assert.doesNotMatch(panel, /panel\.style\.transform/)
    assert.match(panel, /window\.scrollTo\(0, 0\)/)
    assert.match(shell, /dataset\.workspaceViewportLocked = "true"/)
    assert.match(globals, /html\[data-workspace-viewport-locked="true"\]/)
    assert.match(globals, /position: fixed;/)
    assert.match(globals, /\[data-communications-composer\]/)
    assert.match(globals, /calc\(-1 \* var\(--communications-keyboard-inset, 0px\)\)/)
    assert.match(clients, /<footer data-communications-composer/)
    assert.match(team, /<footer data-communications-composer/)
    assert.match(clients, /window\.parent\.document/)
    assert.match(team, /window\.parent\.document/)
    assert.match(team, /Delete this message\? This cannot be undone\./)
    assert.match(team, /start\.minDeltaX < -52/)
    assert.match(team, /start\.verticalAtMin < 42/)
    assert.match(team, /start\.maxDeltaX > 52/)
    assert.match(resizableColumns, /MIN_LIST_WIDTH = 288/)
    assert.match(resizableColumns, /MAX_LIST_WIDTH = 448/)
    assert.match(resizableColumns, /rect\.width \* 0\.42/)
    assert.match(resizableColumns, /aria-label="Resize chat list"/)
    assert.match(resizableColumns, /setPointerCapture\(event\.pointerId\)/)
    assert.match(resizableColumns, /hidden w-4 .*cursor-col-resize .*lg:block/)
    assert.doesNotMatch(resizableColumns, /ResizeIcon|group-hover|shadow-xl/)
    assert.match(jumpToLatest, /aria-label="Jump to latest message"/)
    assert.match(jumpToLatest, /scrollHeight - pane\.scrollTop - pane\.clientHeight > threshold/)
    assert.match(jumpToLatest, /h-10 w-10 min-h-10 min-w-10 max-h-10 max-w-10 shrink-0 aspect-square/)
    assert.match(jumpToLatest, /right-4 inline-flex lg:hidden/)
    assert.match(jumpToLatest, /right-6 hidden lg:inline-flex/)
    assert.match(jumpToLatest, /block h-5 w-5 shrink-0/)
    assert.match(jumpToLatest, /document\.visibilityState !== "visible"/)
    assert.match(globals, /@keyframes betelgeze-message-grow-in/)
    assert.match(globals, /280ms cubic-bezier/)
    assert.match(globals, /@keyframes betelgeze-reaction-popup-in/)
    assert.match(globals, /prefers-reduced-motion: reduce/)
    assert.match(team, /selected\.kind === "team" \? <button/)
    assert.match(team, /!own && selected\.kind === "team" \? <button/)
    assert.match(team, /NativeDeliveryTicks/)
    assert.match(team, /read=\{readers\.length > 0\}/)
    assert.match(clients, /className="pointer-events-none absolute inset-x-0 top-1\/2 -translate-y-1\/2 truncate/)
    assert.match(clients, /selected\.canSend \? `Message \$\{selected\.title\}`/)
    assert.match(team, /className="pointer-events-none absolute inset-x-0 top-1\/2 -translate-y-1\/2 truncate/)
    assert.match(team, /selected\.canWrite \? `Message \$\{selected\.title\}`/)
    assert.match(clients, /<SquarePill tone="yellow" className="!min-h-5/)
    assert.match(page, /isTest: relationship\.source_metadata\.is_test === true/)
    assert.match(types, /isTest: boolean/)
    assert.match(icons, /function DoubleDeliveryCheckIcon/)
    assert.match(icons, /function CopyIcon/)
    assert.match(icons, /function PinIcon/)
    assert.match(icons, /function ReactIcon/)
    assert.match(actions, /recentReactionChoices/)
    assert.match(actions, /navigator\.clipboard/)
    assert.match(actions, /lg:h-8 lg:w-8/)
    assert.match(pinnedBar, /Jump to pinned message/)
    assert.match(pinnedBar, /<PinIcon/)
    assert.match(clients, /setActionView\("reactions"\)/)
    assert.match(team, /setActionView\("reactions"\)/)
    assert.match(clients, /communication_pinned_message_id/)
    assert.match(team, /pinnedMessageId/)
    assert.match(shell, /onClick=\{\(\) => onOpenProfile\(member\.id\)\}/)
    assert.match(clients, /-inset-x-3 inset-y-0/)
    assert.match(team, /-inset-x-3 inset-y-0/)
    assert.doesNotMatch(clients, /actionTop/)
    assert.doesNotMatch(team, /actionTop/)
    assert.match(clients, /VoiceNotePlayer/)
    assert.match(team, /VoiceNotePlayer/)
    assert.match(team, /isSticker \? "mb-1 w-fit rounded-full bg-neutral-950\/80 px-2 py-0\.5" : "mb-0\.5"/)
    assert.match(team, /readers\.map\(\(person\) => <button data-icon-button/)
    assert.match(team, /h-4 w-4 shrink-0 aspect-square/)
    assert.match(clients, /flex shrink-0 items-center -space-x-1/)
    assert.match(team, /flex shrink-0 items-center -space-x-1/)
    assert.match(clients, /h-9 min-h-9 w-full resize-none overflow-y-hidden[^\"]*py-2/)
    assert.match(team, /h-9 min-h-9 w-full resize-none overflow-y-hidden[^\"]*py-2/)
    assert.doesNotMatch(clients, /max-h-9 w-full resize-none/)
    assert.doesNotMatch(team, /max-h-9 w-full resize-none/)
    assert.match(clients, /keepComposerCurrentLineCentered\(composerRef\.current\)/)
    assert.match(team, /keepComposerCurrentLineCentered\(composerRef\.current\)/)
    assert.match(composerScroll, /maximumLines = window\.matchMedia\("\(min-width: 1024px\)"\)\.matches \? 7 : 4/)
    assert.match(composerScroll, /textarea\.style\.height = `\$\{Math\.min\(maximumHeight/)
    assert.match(composerScroll, /textarea\.scrollTop = Math\.max\(0, textarea\.scrollHeight - textarea\.clientHeight\)/)
    assert.match(clients, /<button data-icon-button type="button" onClick=\{\(\) => void sendMessage\(\)\}/)
    assert.match(team, /<button data-icon-button type="button" onClick=\{\(\) => void sendMessage\(\)\}/)
    assert.match(team, /Shared across client and team chats\./)
    assert.match(team, /attachment\.kind === "sticker"/)
    assert.match(team, /isSticker && messageReactions\.length/)
})
