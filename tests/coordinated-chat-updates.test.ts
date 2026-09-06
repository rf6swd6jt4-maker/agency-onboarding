import assert from "node:assert/strict"
import test from "node:test"
import { createCoordinatedChat, ChatMutationError } from "../lib/communications/coordinated-updates.ts"

type Message = { id: string; clientRequestId: string | null; createdAt: string; body: string; editedAt?: string; deliveries?: string[] }
type Conversation = { id: string; messages: Message[]; pinnedMessageId: string | null; canWrite: boolean }
type Reaction = { id: string; messageId: string; reactor: string; emoji: string; updatedAt: string }
const message: Message = { id: "m1", clientRequestId: "request1", createdAt: "2026-09-06T12:00:00Z", body: "Original" }
const reaction = (emoji = "👍", version = "2026-09-06T12:01:00Z", reactor = "u1"): Reaction => ({ id: `r-${reactor}`, messageId: "m1", reactor, emoji, updatedAt: version })
const reactionKey = (r: Reaction) => `${r.messageId}:${r.reactor}`
const snapshot = (messages = [message], reactions: Reaction[] = [], canWrite = true) => ({ conversations: [{ id: "c1", messages, pinnedMessageId: "m1", canWrite }], reactions })
const create = (initial = snapshot()) => createCoordinatedChat<Message, Conversation, Reaction>(initial, reactionKey)
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const ids = (chat: ReturnType<typeof create>) => chat.getSnapshot().conversations[0]?.messages.map((m) => m.id) ?? []

test("capped refreshes keep older loaded media while reconciling deletions inside their coverage", () => {
    const old = { ...message, id: "old", clientRequestId: null, createdAt: "2026-09-01T00:00:00Z" }
    const boundary = { ...message, id: "boundary", clientRequestId: null, createdAt: "2026-09-02T00:00:00Z" }
    const chat = create(snapshot([old, boundary, message]))
    const next = snapshot([])
    chat.applySnapshot(chat.beginRead(), { ...next, conversations: next.conversations.map((conversation) => ({ ...conversation, messageWindowStart: boundary.createdAt })) })
    assert.deepEqual(ids(chat), ["old", "boundary"])
    chat.removeMessage("old")
    assert.deepEqual(ids(chat), ["boundary"], "explicit deletions still apply outside the snapshot window")
    chat.applySnapshot(chat.beginRead(), snapshot([]))
    assert.deepEqual(ids(chat), [], "a complete snapshot still reconciles missed deletions")
})

test("reaction stays visible through reads started before and during its write, including after acknowledgement", async () => {
    const chat = create(), response = deferred<Reaction | null>(), old = chat.beginRead()
    const task = chat.mutateReaction("m1:u1", reaction(), () => response.promise)
    const during = chat.beginRead()
    chat.applySnapshot(old, snapshot())
    chat.applySnapshot(during, snapshot())
    assert.equal(chat.getSnapshot().reactions[0].emoji, "👍")
    response.resolve(reaction()); await task
    chat.applySnapshot(during, snapshot())
    assert.equal(chat.getSnapshot().reactions[0].emoji, "👍")
    chat.applySnapshot(chat.beginRead(), snapshot([message], [reaction("❤️", "2026-09-06T12:02:00Z")]))
    assert.equal(chat.getSnapshot().reactions[0].emoji, "❤️", "newer change from another device must win")
})

test("reaction removal survives stale snapshots and accepts a later re-add", async () => {
    const chat = create(snapshot([message], [reaction()])), old = chat.beginRead()
    await chat.mutateReaction("m1:u1", null, async () => null)
    chat.applySnapshot(old, snapshot([message], [reaction()]))
    assert.equal(chat.getSnapshot().reactions.length, 0)
    chat.receiveReaction("m1:u1", reaction("❤️", "2026-09-06T12:03:00Z"))
    assert.equal(chat.getSnapshot().reactions[0].emoji, "❤️")
})

test("delete survives stale full and targeted reads, clears pins, and hides its reactions", async () => {
    const chat = create(snapshot([message], [reaction()])), old = chat.beginRead(), response = deferred<Message | null>()
    const task = chat.mutateMessage("m1", null, () => response.promise)
    chat.applySnapshot(old, snapshot([message], [reaction()]))
    chat.mergeReadMessages(old, "c1", [message])
    assert.deepEqual(ids(chat), [])
    assert.equal(chat.getSnapshot().conversations[0].pinnedMessageId, null)
    assert.deepEqual(chat.getSnapshot().reactions, [])
    response.resolve(null); await task
    chat.mergeReadMessages(old, "c1", [message])
    assert.deepEqual(ids(chat), [])
})

test("failed deletion restores only its message, retaining concurrent arrivals and other deletions", async () => {
    const other = { ...message, id: "m2", clientRequestId: "request2" }, arrival = { ...message, id: "m3", clientRequestId: "request3" }
    const chat = create(snapshot([message, other])), response = deferred<Message | null>()
    const task = chat.mutateMessage("m1", null, () => response.promise)
    chat.removeMessage("m2")
    chat.setConversations((current) => current.map((c) => ({ ...c, messages: [...c.messages, arrival] })))
    response.reject(new ChatMutationError("Forbidden")); await assert.rejects(task)
    assert.deepEqual(ids(chat).sort(), ["m1", "m3"])
})

test("uncertain acknowledgement keeps intent until a read begun after settlement establishes server truth", async () => {
    const chat = create(), old = chat.beginRead()
    await assert.rejects(chat.mutateMessage("m1", null, async () => { throw new ChatMutationError("Lost response", true) }))
    chat.applySnapshot(old, snapshot()); assert.deepEqual(ids(chat), [])
    chat.applySnapshot(chat.beginRead(), snapshot()); assert.deepEqual(ids(chat), ["m1"])
})

test("rapid writes to the same reaction are serial, while another member's reaction remains independent", async () => {
    const chat = create(), first = deferred<Reaction | null>(), second = deferred<Reaction | null>(), calls: string[] = []
    const a = chat.mutateReaction("m1:u1", reaction(), () => { calls.push("first"); return first.promise })
    const b = chat.mutateReaction("m1:u1", reaction("❤️"), () => { calls.push("second"); return second.promise })
    await chat.mutateReaction("m1:u2", reaction("🎉", undefined, "u2"), async () => reaction("🎉", undefined, "u2"))
    assert.deepEqual(calls, ["first"])
    first.resolve(reaction()); await a; await Promise.resolve()
    assert.deepEqual(calls, ["first", "second"])
    second.resolve(reaction("❤️", "2026-09-06T12:02:00Z")); await b
    assert.deepEqual(chat.getSnapshot().reactions.map((r) => r.emoji).sort(), ["❤️", "🎉"].sort())
})

test("a rejected queued change restores the last confirmed change, not an old captured array", async () => {
    const chat = create(), first = deferred<Reaction | null>()
    const a = chat.mutateReaction("m1:u1", reaction(), () => first.promise)
    const b = chat.mutateReaction("m1:u1", reaction("❤️"), async () => { throw new ChatMutationError("Rejected") })
    first.resolve(reaction()); await a; await assert.rejects(b)
    assert.equal(chat.getSnapshot().reactions[0].emoji, "👍")
})

test("newer realtime state survives a stale refresh and an older mutation response", async () => {
    const chat = create(), old = chat.beginRead(), response = deferred<Reaction | null>()
    const task = chat.mutateReaction("m1:u1", reaction(), () => response.promise)
    chat.receiveReaction("m1:u1", reaction("❤️", "2026-09-06T12:05:00Z"))
    response.resolve(reaction()); await task
    chat.applySnapshot(old, snapshot())
    chat.receiveReaction("m1:u1", reaction())
    assert.equal(chat.getSnapshot().reactions[0].emoji, "❤️")
})

test("out of order full snapshots cannot revert metadata or message state", () => {
    const chat = create(), old = chat.beginRead(), fresh = chat.beginRead()
    chat.applySnapshot(fresh, snapshot([], [], false))
    assert.equal(chat.applySnapshot(old, snapshot()), false)
    assert.deepEqual(ids(chat), [])
    assert.equal(chat.getSnapshot().conversations[0].canWrite, false)
})

test("out of order targeted reads cannot revert newer message content", () => {
    const chat = create(), old = chat.beginRead(), fresh = chat.beginRead()
    chat.mergeReadMessages(fresh, "c1", [{ ...message, body: "Edited" }])
    chat.mergeReadMessages(old, "c1", [message])
    assert.equal(chat.getSnapshot().conversations[0].messages[0].body, "Edited")
})

test("fresh recovery removes missed deletions while pending writes do not block access changes", async () => {
    const chat = create(), response = deferred<Reaction | null>()
    const task = chat.mutateReaction("m1:u1", reaction(), () => response.promise)
    chat.applySnapshot(chat.beginRead(), snapshot([message], [], false))
    assert.equal(chat.getSnapshot().conversations[0].canWrite, false)
    chat.applySnapshot(chat.beginRead(), { conversations: [], reactions: [] })
    response.resolve(reaction()); await task
    assert.deepEqual(chat.getSnapshot(), { conversations: [], reactions: [] })
    const another = create()
    another.applySnapshot(another.beginRead(), snapshot([]))
    assert.deepEqual(ids(another), [])
})

test("pending sends survive refresh, deduplicate on acknowledgement, and never resurrect after deletion", () => {
    const optimistic = { ...message, id: "request1" }
    const chat = create(snapshot([optimistic]))
    chat.applySnapshot(chat.beginRead(), snapshot([]))
    assert.deepEqual(ids(chat), ["request1"])
    chat.applySnapshot(chat.beginRead(), snapshot([message]))
    assert.deepEqual(ids(chat), ["m1"])
    chat.removeMessage("m1")
    chat.applySnapshot(chat.beginRead(), snapshot([]))
    assert.deepEqual(ids(chat), [])
})

test("delivery updates arriving during a refresh are preserved", () => {
    const chat = create(), old = chat.beginRead()
    chat.setConversations((current) => current.map((c) => ({ ...c, messages: c.messages.map((m) => ({ ...m, deliveries: ["read"] })) })))
    chat.applySnapshot(old, snapshot())
    assert.deepEqual(chat.getSnapshot().conversations[0].messages[0].deliveries, ["read"])
})

test("pin changes survive in-flight snapshots and later accept another device's pin", async () => {
    const chat = create(), old = chat.beginRead()
    await chat.mutatePin("c1", null, async () => undefined)
    chat.applySnapshot(old, snapshot())
    assert.equal(chat.getSnapshot().conversations[0].pinnedMessageId, null)
    chat.applySnapshot(chat.beginRead(), snapshot())
    assert.equal(chat.getSnapshot().conversations[0].pinnedMessageId, "m1")
})

test("a delayed upsert echo cannot restore a removed reaction, even after recovery confirms its absence", async () => {
    const chat = create(snapshot([message], [reaction()]))
    await chat.mutateReaction("m1:u1", null, async () => null)
    chat.receiveReaction("m1:u1", reaction())
    assert.deepEqual(chat.getSnapshot().reactions, [])
    chat.applySnapshot(chat.beginRead(), snapshot())
    chat.receiveReaction("m1:u1", reaction())
    assert.deepEqual(chat.getSnapshot().reactions, [])
    chat.receiveReaction("m1:u1", reaction("❤️", "2026-09-06T12:10:00Z"))
    chat.receiveReaction("m1:u1", null, reaction().updatedAt)
    assert.equal(chat.getSnapshot().reactions[0].emoji, "❤️", "late DELETE for the old row must not remove its replacement")
})

test("an add acknowledgement cannot restore a reaction already removed by another device", async () => {
    const chat = create(), response = deferred<Reaction | null>()
    const task = chat.mutateReaction("m1:u1", reaction(), () => response.promise)
    chat.receiveReaction("m1:u1", reaction())
    chat.receiveReaction("m1:u1", null, reaction().updatedAt)
    response.resolve(reaction()); await task
    assert.deepEqual(chat.getSnapshot().reactions, [])
})

test("send acknowledgement survives a newer pre-commit refresh but cannot roll back newer delivery events", () => {
    const optimistic = { ...message, id: "request1" }, chat = create(snapshot([optimistic]))
    const request = chat.beginRead()
    chat.applySnapshot(chat.beginRead(), snapshot([]))
    chat.mergeReadMessages(request, "c1", [message], true)
    assert.deepEqual(ids(chat), ["m1"])
    const another = create(snapshot([optimistic])), old = another.beginRead()
    another.setConversations((rows) => rows.map((c) => ({ ...c, messages: [{ ...message, deliveries: ["read"] }] })))
    another.mergeReadMessages(old, "c1", [{ ...message, deliveries: ["sent"] }], true)
    assert.deepEqual(another.getSnapshot().conversations[0].messages[0].deliveries, ["read"])
})

test("message editing and deletion share a queue and recover without resurrecting old text", async () => {
    const chat = create(), response = deferred<Message | null>(), old = chat.beginRead()
    const edit = chat.mutateMessage("m1", { ...message, body: "Edited" }, () => response.promise)
    const remove = chat.mutateMessage("m1", null, async () => null)
    chat.applySnapshot(old, snapshot())
    assert.equal(chat.getSnapshot().conversations[0].messages[0].body, "Edited")
    response.resolve({ ...message, body: "Edited", editedAt: "2026-09-06T12:02:00Z" }); await edit; await remove
    chat.mergeReadMessages(old, "c1", [message])
    assert.deepEqual(ids(chat), [])
})

test("id-only realtime deletions fence off already-running fetches, even for rows not loaded yet", () => {
    const chat = create(snapshot([])), read = chat.beginRead()
    chat.removeMessage("m1")
    chat.mergeReadMessages(read, "c1", [message])
    assert.deepEqual(ids(chat), [])
})

test("guarded incoming messages still move their conversation to the top", () => {
    const chat = create({ conversations: [...snapshot().conversations, { ...snapshot().conversations[0], id: "c2", messages: [] }], reactions: [] })
    chat.mergeReadMessages(chat.beginRead(), "c2", [{ ...message, id: "m2", clientRequestId: "request2", createdAt: "2026-09-06T13:00:00Z" }])
    assert.deepEqual(chat.getSnapshot().conversations.map((c) => c.id), ["c2", "c1"])
})
