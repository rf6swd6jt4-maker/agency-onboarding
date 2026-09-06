import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import sharp from "sharp"

import { communicationAttachmentFromRawPayload } from "../lib/communications/attachments.ts"
import { clientMessageSupportsReaction } from "../lib/communications/interactions.ts"
import { convertCommunicationStickerImage } from "../lib/communications/stickers.ts"

test("client portal messages always support agency reactions", () => {
    assert.equal(clientMessageSupportsReaction({
        provider: "client_portal",
        providerMessageId: null,
        deliveries: [],
        createdAt: "2020-01-01T00:00:00.000Z",
    }, Date.now()), true)
})

test("provider reactions remain restricted to eligible WhatsApp messages", () => {
    const cutoff = new Date("2026-01-01T00:00:00.000Z").getTime()
    assert.equal(clientMessageSupportsReaction({
        provider: "meta_whatsapp",
        providerMessageId: "wamid.example",
        deliveries: [],
        createdAt: "2026-01-02T00:00:00.000Z",
    }, cutoff), true)
    assert.equal(clientMessageSupportsReaction({
        provider: "twilio_sms",
        providerMessageId: "SMexample",
        deliveries: [],
        createdAt: "2026-01-02T00:00:00.000Z",
    }, cutoff), false)
})

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
    assert.match(stickers, /loadCommunicationMessages/)
    assert.match(stickers, /message\.attachment/)
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
    assert.match(actions, /SaveIcon/)
    assert.match(actions, /anchor\.download/)
    assert.match(actions, /URL\.createObjectURL/)
    assert.doesNotMatch(actions, /EMOJI_CATALOGUE/)
    assert.match(pinMigration, /communication_pinned_message_id/)
    assert.match(pinMigration, /pinned_message_id/)
    assert.match(pins, /eq\("relationship_id", relationshipId\)/)
    assert.match(workspace, /JPEG and PNG images are converted automatically/)
    assert.match(workspace, /Save sticker/)
    assert.match(workspace, /saveOrDownloadAttachment/)
    assert.match(workspace, /message\.senderUserId !== bootstrap\.currentUser\.id/)
    assert.match(workspace, /messageId: message\.id/)
})

test("message interactions keep the approved mobile and profile parity", async () => {
    const [clients, team, composer, composerPreview, composerScroll, keyboardSlide, page, bootstrap, panel, types, icons, shell, resizableColumns, jumpToLatest, messagePaneScroll, globals, actions, pinnedBar, rootLayout, paneInteractions, composerViewport, readAvatars] = await Promise.all([
        readFile("components/communications/CommunicationsWorkspace.tsx", "utf8"),
        readFile("components/communications/TeamCommunicationsWorkspace.tsx", "utf8"),
        readFile("components/communications/MessageComposer.tsx", "utf8"),
        readFile("components/communications/ComposerMessagePreview.tsx", "utf8"),
        readFile("components/communications/composer-scroll.ts", "utf8"),
        readFile("components/communications/composer-keyboard-slide.ts", "utf8"),
        readFile("app/[workspaceSlug]/communications/page.tsx", "utf8"),
        readFile("lib/communications/bootstrap.ts", "utf8"),
        readFile("components/communications/CommunicationsPanel.tsx", "utf8"),
        readFile("lib/communications/types.ts", "utf8"),
        readFile("components/communications/MessageInteractionIcons.tsx", "utf8"),
        readFile("components/workspace/WorkspaceTopBarClient.tsx", "utf8"),
        readFile("components/communications/ResizableConversationColumns.tsx", "utf8"),
        readFile("components/communications/JumpToLatestButton.tsx", "utf8"),
        readFile("components/communications/message-pane-scroll.ts", "utf8"),
        readFile("app/globals.css", "utf8"),
        readFile("components/communications/MessageActionMenu.tsx", "utf8"),
        readFile("components/communications/PinnedMessageBar.tsx", "utf8"),
        readFile("app/layout.tsx", "utf8"),
        readFile("components/communications/useMessagePaneInteractions.ts", "utf8"),
        readFile("lib/workspace-composer-viewport.ts", "utf8"),
        readFile("components/communications/MessageReadAvatars.tsx", "utf8"),
    ])
    assert.match(clients, /data-message-action-popup/)
    for (const source of [clients, team]) {
        assert.match(source, /touch-pan-y overflow-x-hidden overflow-y-auto overscroll-x-none overscroll-y-contain/)
        assert.match(source, /style=\{\{ overflowAnchor: "none" \}\}/)
        assert.match(source, /mx-auto flex min-h-full w-full min-w-0 max-w-3xl flex-col gap-2 lg:max-w-none/)
        assert.match(source, /aria-hidden="true" className="mt-auto"/)
        assert.match(source, /<ResizableConversationColumns listWidth=\{conversationListWidth\} onListWidthChange=\{onConversationListWidthChange\}>/)
        assert.match(source, /onTouchCancel/)
        assert.match(source, /max-w-\[80%\]/)
        assert.match(source, /min-w-0 touch-pan-y cursor-pointer/)
        assert.doesNotMatch(source, /min-w-0 max-w-full touch-pan-y cursor-pointer/)
        assert.match(source, /useMessagePaneInteractions\(composerRef, followLatestRef, setAtLatest, setShowJumpToLatest\)/)
        assert.match(source, /\{\.\.\.messagePaneInteractions\}/)
        assert.match(source, /scrollTo\(\{ top: messagePaneRef\.current\.scrollHeight, left: 0 \}\)/)
        assert.match(source, /behavior: "smooth"/)
        assert.match(source, /messagePaneCanShowNewMessage\(messagePaneRef\.current, followLatestRef\.current\)/)
        assert.match(source, /betelgeze-message-enter-right/)
        assert.match(source, /betelgeze-message-enter-left/)
        assert.match(source, /betelgeze-popup-enter/)
    }
    assert.match(team, /data-message-action-popup/)
    assert.doesNotMatch(panel, /visualViewport|scrollTo|useLayoutEffect/)
    assert.match(panel, /fixed inset-0 isolate overflow-hidden overscroll-none bg-black/)
    assert.match(shell, /dataset\.workspaceViewportLocked = "true"/)
    assert.match(shell, /element\.hidden = true/)
    assert.match(shell, /element\.hidden = hidden/)
    assert.match(shell, /--workspace-visual-viewport-bottom/)
    assert.match(shell, /return Math\.round\(\(visualViewport\?\.offsetTop \?\? 0\) \+ \(visualViewport\?\.height \?\? window\.innerHeight\)\)/)
    assert.match(shell, /visualViewport\?\.addEventListener\("scroll", holdWorkspaceViewport\)/)
    assert.match(shell, /WORKSPACE_KEYBOARD_MOTION_MS = 300/)
    assert.match(shell, /WORKSPACE_KEYBOARD_SETTLE_MS = WORKSPACE_KEYBOARD_MOTION_MS \+ 340/)
    assert.match(shell, /WORKSPACE_KEYBOARD_MINIMUM_SHIFT_PX = 64/)
    assert.match(shell, /viewportMode: "idle" \| "pending" \| "continuous" \| "synthetic" \| "closing" \| "suspended"/)
    assert.match(shell, /keyboardViewportBottom = Math\.min\(keyboardViewportBottom \?\? viewportBottom, viewportBottom\)/)
    assert.match(shell, /syntheticTargetCommitted = true\s+writeViewportBottom\(keyboardViewportBottom\)/)
    assert.match(shell, /WORKSPACE_KEYBOARD_SETTLE_MS/)
    assert.match(shell, /addEventListener\(WORKSPACE_COMPOSER_FOCUS_EVENT, handleComposerFocus\)/)
    assert.match(shell, /dataset\.workspaceKeyboardMotion = "true"/)
    assert.match(shell, /document\.visibilityState === "hidden"/)
    assert.match(shell, /activeElement instanceof HTMLElement\) activeElement\.blur\(\)/)
    assert.match(shell, /document\.addEventListener\("visibilitychange", handleWorkspaceVisibility\)/)
    assert.match(shell, /window\.addEventListener\("pagehide", suspendWorkspaceViewport\)/)
    assert.match(shell, /window\.addEventListener\("pageshow", resumeWorkspaceViewport\)/)
    assert.match(shell, /if \(root\.scrollTop !== 0\) root\.scrollTop = 0/)
    assert.doesNotMatch(shell, /--workspace-visual-viewport-top/)
    assert.match(shell, /const holdWorkspaceViewport = \(\) => \{\s+if \(document\.visibilityState === "hidden"\) return[\s\S]{0,180}const viewportBottom = readViewportBottom\(\)/)
    assert.doesNotMatch(shell, /window\.scrollTo\(0, 0\)/)
    assert.match(globals, /html\[data-workspace-viewport-locked="true"\]/)
    assert.match(globals, /position: fixed;/)
    assert.doesNotMatch(globals, /--workspace-visual-viewport-top|\[data-workspace-topbar\][\s\S]*translate3d/)
    assert.match(globals, /\[data-workspace-tab-panels\] \{\s+top: 6\.25rem;/)
    assert.match(globals, /height: max\(0px, calc\(var\(--workspace-visual-viewport-bottom, 100dvh\) - 6\.25rem\)\)/)
    assert.match(globals, /data-workspace-keyboard-motion="true"[\s\S]*transition: height 300ms cubic-bezier\(0\.32, 0\.72, 0, 1\)/)
    assert.match(globals, /backface-visibility: hidden;[\s\S]*transform: translateZ\(0\)/)
    assert.doesNotMatch(globals, /communications-keyboard-inset|communications-viewport-locked/)
    assert.match(clients, /window\.parent\.document/)
    assert.match(team, /window\.parent\.document/)
    assert.match(team, /Delete this message\? This cannot be undone\./)
    assert.match(team, /start\.minDeltaX < -52/)
    assert.match(team, /start\.verticalAtMin < 42/)
    assert.match(team, /start\.maxDeltaX > 52/)
    assert.doesNotMatch(clients, /onClick=\{\(\) => composerRef\.current\?\.blur\(\)\}/)
    assert.doesNotMatch(team, /onClick=\{\(\) => composerRef\.current\?\.blur\(\)\}/)
    assert.doesNotMatch(clients, /onPointerDown=\{\(\) => composerRef\.current\?\.blur\(\)\}/)
    assert.doesNotMatch(team, /onPointerDown=\{\(\) => composerRef\.current\?\.blur\(\)\}/)
    assert.match(composer, /max-w-3xl touch-manipulation items-center/)
    assert.match(composer, /onPointerDown=\{\(event\) => \{[\s\S]{0,400}event\.currentTarget\.focus\(\{ preventScroll: true \}\)/)
    assert.match(composer, /onClick=\{\(event\) => \{/)
    assert.match(composer, /document\.activeElement !== event\.currentTarget/)
    assert.doesNotMatch(composer, /onPointerDown=\{[\s\S]{0,400}event\.preventDefault\(\)|setSelectionRange/)
    assert.match(composer, /reportWorkspaceComposerFocus\(true\)/)
    assert.match(composer, /document\.addEventListener\("visibilitychange", blurComposerWhenHidden\)/)
    assert.match(composer, /window\.addEventListener\("pagehide", blurComposer\)/)
    assert.match(composer, /reportWorkspaceComposerFocus\(false\)/)
    assert.match(composerViewport, /WORKSPACE_COMPOSER_FOCUS_EVENT/)
    assert.match(composerViewport, /window\.parent === window/)
    assert.match(composerViewport, /export function closeWorkspaceComposer\(composer: HTMLTextAreaElement \| null\)/)
    assert.match(composerViewport, /composer\?\.blur\(\)[\s\S]*reportWorkspaceComposerFocus\(false\)/)
    for (const source of [clients, team]) assert.match(source, /(?:const )?selectConversation[\s\S]{0,180}closeWorkspaceComposer\(composerRef\.current\)/)
    assert.match(team, /<button data-icon-button type="button" onClick=\{\(event\) => \{ event\.stopPropagation\(\); openWorkspaceMemberProfile\(message\.senderUserId\) \}\} className=\{`\$\{isSticker/)
    assert.match(paneInteractions, /POINTER_SCROLL_THRESHOLD_PX = 6/)
    assert.match(paneInteractions, /if \(!gesture \|\| gesture\.pointerId !== event\.pointerId\) return/)
    assert.match(paneInteractions, /if \(gesture\.moved\) markUserScroll\(\)\s+else composerRef\.current\?\.blur\(\)/)
    assert.match(paneInteractions, /const userScrolling = Boolean\(pointerGestureRef\.current\?\.moved\) \|\| performance\.now\(\) < userScrollUntilRef\.current/)
    assert.match(paneInteractions, /if \(userScrolling\) \{\s+markUserScroll\(\)\s+followLatestRef\.current = following/)
    assert.match(paneInteractions, /const anchoredToLatest = !userScrolling && followLatestRef\.current/)
    assert.match(rootLayout, /interactiveWidget: "resizes-visual"/)
    assert.doesNotMatch(composer, /navigator\.userAgent|iPhone|iPad|Android/)
    assert.match(clients, /shrink-0 touch-manipulation border-t/)
    assert.match(team, /shrink-0 touch-manipulation border-t/)
    assert.match(composerPreview, /onPointerDown=\{\(event\) => event\.preventDefault\(\)\}/)
    assert.match(composerPreview, /onClick=\{onCancel\} aria-label="Cancel reply"/)
    for (const source of [clients, team]) assert.match(source, /onCancel=\{\(\) => \{ setReplyingTo\(null\); composerRef\.current\?\.focus\(\{ preventScroll: true \}\) \}\}/)
    assert.match(resizableColumns, /MIN_LIST_WIDTH = 288/)
    assert.match(resizableColumns, /MAX_LIST_WIDTH = 448/)
    assert.match(resizableColumns, /rect\.width \* 0\.42/)
    assert.match(resizableColumns, /aria-label="Resize chat list"/)
    assert.match(resizableColumns, /setPointerCapture\(event\.pointerId\)/)
    assert.match(resizableColumns, /hidden w-4 .*cursor-col-resize .*lg:block/)
    assert.doesNotMatch(resizableColumns, /ResizeIcon|group-hover|shadow-xl/)
    assert.match(jumpToLatest, /aria-label="Jump to latest message"/)
    assert.doesNotMatch(jumpToLatest, /data-jump-to-latest/)
    assert.match(jumpToLatest, /scrollHeight - pane\.scrollTop - pane\.clientHeight > threshold/)
    assert.match(jumpToLatest, /data-icon-button/)
    assert.match(jumpToLatest, /box-border shrink-0 aspect-square place-items-center overflow-hidden rounded-full/)
    assert.match(jumpToLatest, /right-4 grid h-11 w-11 min-h-11 min-w-11 max-h-11 max-w-11 lg:hidden/)
    assert.match(jumpToLatest, /right-6 hidden h-10 w-10 min-h-10 min-w-10 max-h-10 max-w-10 lg:grid/)
    assert.match(jumpToLatest, /block h-5 w-5 shrink-0/)
    assert.match(jumpToLatest, /document\.visibilityState !== "visible"/)
    assert.match(jumpToLatest, /new ResizeObserver/)
    assert.match(jumpToLatest, /anchoredMessagePaneScrollTop/)
    assert.match(jumpToLatest, /pane\.addEventListener\("scroll", rememberScrollPosition/)
    assert.match(jumpToLatest, /pane\.scrollTo\(\{ top: nextScrollTop, left: 0 \}\)/)
    assert.doesNotMatch(jumpToLatest, /composerHeightDelta|paneHeightDelta|observer\.observe\(composer\)/)
    assert.match(messagePaneScroll, /if \(followingLatest\) return maximumScrollTop/)
    assert.match(messagePaneScroll, /previousScrollTop \+ previousClientHeight - nextClientHeight/)
    assert.match(clients, /observeMessagePaneResize\(messagePaneRef\.current, \(\) => followLatestRef\.current, true\)/)
    assert.match(team, /observeMessagePaneResize\(messagePaneRef\.current, \(\) => followLatestRef\.current, true\)/)
    assert.match(globals, /@keyframes betelgeze-message-grow-in/)
    assert.match(globals, /280ms cubic-bezier/)
    assert.match(globals, /@keyframes betelgeze-popup-in/)
    assert.match(globals, /prefers-reduced-motion: reduce/)
    assert.match(team, /selected\.kind === "team" \? sender\?\.former/)
    assert.match(team, /!own && selected\.kind === "team" \? sender\?\.former/)
    assert.match(team, /former member/)
    assert.match(team, /NativeDeliveryTicks/)
    assert.match(team, /read=\{readers\.length > 0\}/)
    assert.match(composer, /text-base leading-6[^\"]*lg:text-sm lg:leading-5/)
    assert.match(composer, /enterKeyHint="send"/)
    assert.match(composer, /event\.nativeEvent\.isComposing/)
    assert.match(composer, /hidden max-w-3xl[^\"]*lg:block/)
    assert.match(composer, /h-11 min-h-11[^\"]*lg:h-9 lg:min-h-9/)
    assert.match(clients, /selected\.canSend \? `Message \$\{selected\.title\}`/)
    assert.match(team, /selected\.canWrite \? `Message \$\{selected\.title\}`/)
    assert.match(clients, /<SquarePill tone="yellow" className="!min-h-5/)
    assert.match(page, /loadClientCommunicationsBootstrap/)
    assert.match(bootstrap, /isTest: relationship\.source_metadata\.is_test === true/)
    assert.match(types, /isTest: boolean/)
    assert.match(icons, /function DoubleDeliveryCheckIcon/)
    assert.match(icons, /function SingleDeliveryCheckIcon/)
    assert.equal((icons.match(/m1 5 2\.4 2\.4L8\.7 1\.6/g) ?? []).length, 2)
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
    assert.match(team, /NativeAttachment/)
    assert.match(await readFile("components/communications/NativeAttachment.tsx", "utf8"), /VoiceNotePlayer/)
    for (const source of [clients, team]) {
        assert.match(source, /scale-\[1\.03\]/)
        assert.match(source, /opacity-30 blur-\[1px\]/)
        assert.match(source, /<ComposerMessagePreview/)
    }
    assert.doesNotMatch(team, /ring-2 ring-white ring-offset-2 ring-offset-black/)
    assert.match(team, /isSticker \? "mb-1 w-fit rounded-full bg-neutral-950\/80 px-2 py-0\.5" : "mb-0\.5"/)
    for (const source of [clients, team]) assert.match(source, /<MessageReadAvatars readers=\{readers\} \/>/)
    assert.match(readAvatars, /flex min-w-0 items-center -space-x-1/)
    assert.match(readAvatars, /h-4 w-4 shrink-0 aspect-square/)
    assert.match(composer, /flex shrink-0 items-center -space-x-1/)
    assert.match(clients, /<MessageComposer/)
    assert.match(team, /<MessageComposer/)
    assert.doesNotMatch(clients, /window\.addEventListener\("resize", resizeComposer\)/)
    assert.doesNotMatch(team, /window\.addEventListener\("resize", resizeComposer\)/)
    assert.match(clients, /keepComposerCurrentLineCentered\(composerRef\.current\)/)
    assert.match(team, /keepComposerCurrentLineCentered\(composerRef\.current\)/)
    assert.match(composer, /transition-\[height\] duration-\[180ms\] ease-\[cubic-bezier\(0\.25,0\.1,0\.25,1\)\] motion-reduce:transition-none/)
    assert.match(composerScroll, /maximumLines = window\.matchMedia\("\(min-width: 1024px\)"\)\.matches \? 7 : 4/)
    assert.match(composerScroll, /const currentHeight = textarea\.getBoundingClientRect\(\)\.height \|\| minimumHeight/)
    assert.match(composerScroll, /const measurement = textarea\.cloneNode\(false\)/)
    assert.match(composerScroll, /const measurementHost = textarea\.parentElement \?\? document\.body[\s\S]*measurementHost\.appendChild\(measurement\)/)
    assert.doesNotMatch(composerScroll, /textarea\.style\.height = `\$\{minimumHeight\}px`/)
    assert.match(composerScroll, /const nextHeight = Math\.min\(maximumHeight/)
    assert.match(composerScroll, /textarea\.style\.transition = "none"[\s\S]*textarea\.style\.height = `\$\{currentHeight\}px`[\s\S]*textarea\.style\.transition = inlineTransition[\s\S]*textarea\.style\.height = `\$\{nextHeight\}px`/)
    assert.match(composerScroll, /textarea\.scrollTop = Math\.max\(0, textarea\.scrollHeight - textarea\.clientHeight\)/)
    for (const source of [clients, team]) {
        assert.doesNotMatch(source, /messageContentRef|composerFooterRef|useComposerKeyboardSlide/)
        assert.match(source, /<div className="mx-auto flex min-h-full w-full min-w-0 max-w-3xl flex-col/)
        assert.match(source, /<footer className="relative z-10 shrink-0 touch-manipulation/)
    }
    assert.match(keyboardSlide, /hostWindow\.visualViewport\?\.addEventListener\("resize", scheduleKeyboardSlide\)/)
    assert.match(keyboardSlide, /footer\.contains\(document\.activeElement\)/)
    assert.doesNotMatch(keyboardSlide, /messagePane|messageContent|data-jump-to-latest/)
    assert.match(keyboardSlide, /prefers-reduced-motion: reduce/)
    assert.match(keyboardSlide, /translate3d\(0, \$\{shift\}px, 0\)/)
    assert.match(keyboardSlide, /KEYBOARD_SLIDE_DURATION_MS = 220/)
    assert.doesNotMatch(keyboardSlide, /navigator\.userAgent|iPhone|iPad|Android/)
    assert.match(composer, /<button data-icon-button type="submit"/)
    assert.match(team, /Shared across client and team chats\./)
    assert.match(team, /attachment\.kind === "sticker"/)
    assert.match(team, /isSticker && messageReactions\.length/)
})
