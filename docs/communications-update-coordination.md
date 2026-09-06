# Communications update coordination

Client and team/direct Comms views use `lib/communications/coordinated-updates.ts` through React's `useSyncExternalStore`. This store coordinates message, reaction, and pin state. Connection recovery, authentication, subscriptions, API authorization, read cursors, and typing transport retain their existing owners. The standalone Client Portal has a separate implementation.

## Reads and writes

Every full refresh and targeted message fetch captures a read token **before** starting the request. The token contains a local change revision and a read sequence. A response cannot overwrite a record changed since that read began, or replace a newer accepted read. A full snapshot remains authoritative for unchanged records, including deletions missed while disconnected.

Full snapshots always supply conversation membership, availability, and write permissions. Protecting a message action must not retain a conversation that the server no longer exposes. Partial reads cannot add conversations back.

Workspace message snapshots carry `messageWindowStart`: omission from a capped history window is not a deletion of older loaded history. The boundary timestamp is retained because a tied timestamp group may be truncated. The selected conversation receives a separate scoped snapshot (500 client / 1,000 native messages); a shorter scoped result is complete, including a chat cleared on another device. Explicit message deletions and loss of conversation access still take effect immediately.

Actions have a pending value layered over the last confirmed value. Requests for the same record run serially; separate records can update independently. Realtime changes can update the confirmed value without hiding the pending action. Successful responses reconcile the saved value. A definite rejection removes only that action's pending value. A lost or ambiguous response retains the intent until a new server read resolves it. Action completion starts another refresh; the existing periodic and reconnect refreshes remain the fallback if that read fails.

Settlement advances the revision too: a read started during the action is still stale after the acknowledgement. Older reaction versions, including delayed removal/upsert echoes, cannot overwrite newer versions. Pin events without a comparable version prompt an authoritative read instead of applying possibly old pin values directly.

## Message lifecycle

Message sends retain their request IDs through acknowledgement. Durable rows replace provisional rows without remounting the message bubble. A stale send acknowledgement cannot downgrade a newer realtime delivery update, and a failed acknowledgement cannot remove a message already confirmed through realtime.

Message tombstones prevent older targeted reads from restoring a deleted message. Projecting a deletion hides its pin and reactions without destroying their confirmed state, so a rejected deletion restores that message's related UI without restoring an old conversation array. Edits and deletes share a per-message request queue. Clearing a private chat uses the same mechanism for the currently displayed messages and reconciles the server's complete result afterwards.

## Validation

`tests/coordinated-chat-updates.test.ts` exercises deferred requests, out-of-order snapshots and targeted reads, reaction removal echoes, acknowledgements, serial writes, rejected and uncertain actions, access changes, pending sends, delivery updates, edits, and deletion recovery. Existing source integration tests cover the transport and acknowledgement contracts. These deterministic tests do not substitute for multi-device or physical mobile verification.

## Deletion confirmation

Team/direct chat swipes and bin actions call the same `deleteMessage` handler, which opens the device's native confirmation through `window.confirm()`. Only accepting that confirmation invokes the coordinated mutation. Cancelling leaves the message untouched.

The swipe recognizer locks horizontal intent, remembers an action once its threshold is crossed, and ignores late release jitter. Vertical-first scrolling, touch cancellation, another finger, and insufficient permissions cannot complete an action. `tests/message-swipe.test.ts` covers those paths.

## Media layout and loading

Client and team Comms use `useConversationLayout` to position the initial pane before paint and observe both the pane and its inner message content. While following latest, content growth stays bottom-aligned. While reading history, the controller retains the visible message's offset; pane height changes preserve the visible bottom. Hiding a workspace tab does not reset its anchor. Wheel, touch, keyboard and scrollbar input release follow mode, and read receipts use measured bottom proximity. This leaves the established shell/composer keyboard controller in place.

The first render contains the latest 60 messages. Earlier fetched history expands upward without evicting mounted bubbles, and reply/pin navigation reveals its target before scrolling. This is a rendering window, not database cursor pagination; bootstrap still supplies the existing conversation and unread data.

Attachments retain a fixed frame through decoding, refresh, failure and retry. New uploads carry bounded width, height and duration hints and can upload a 960px WebP preview or video poster alongside the original. Animated images retain their originals. Incoming provider images acquire orientation-aware dimensions. Older images get a private cached derivative on first preview request; older video files use a stable fallback frame and load on play. There is no bulk historical metadata backfill or server video transcoding.

Visible image previews precede the nearby buffer through a four-slot queue. Admission is one-way for the mounted attachment: leaving the viewport does not clear its source. Hidden conversation panes do not admit new previews. Video and audio use `preload="none"`, with saved audio duration when available.

Previews use the original attachment's authorization and SSE-C key and are deleted alongside the original. The media proxy preserves conditional and byte-range request headers, passes through 304/416 responses, uses upstream HEAD for HEAD requests, and exposes aggregate authorization/storage durations in `Server-Timing`. Browser caching remains private.

Regression coverage includes `tests/communications-media.test.ts`, `tests/conversation-layout.test.ts`, and the snapshot-window case in `tests/coordinated-chat-updates.test.ts`. Browser verification must also cover delayed media, retry without resizing, upward expansion, hidden-tab restoration and mobile-width reflow; source assertions alone are insufficient.
