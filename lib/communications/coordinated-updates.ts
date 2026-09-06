/** Coordinates HTTP reads, live events, and local writes without changing transport. */
export type ChatRead = { revision: number; sequence: number }
export class ChatMutationError extends Error {
    readonly uncertain: boolean
    constructor(message: string, uncertain = false) { super(message); this.uncertain = uncertain }
}

type Message = { id: string; clientRequestId: string | null; createdAt: string; replyToMessageId?: string | null }
type Conversation<M> = { id: string; messages: M[]; pinnedMessageId: string | null; updatedAt?: string; title?: string }
type Reaction = { id: string; messageId: string; updatedAt: string }
type Cell<T> = { value: T | null; revision: number; pending?: { value: T | null }; version: string; readSequence?: number }
type Setter<T> = T | ((current: T) => T)

function collection<T>(keyOf: (value: T) => string, tick: () => number, versionOf: (value: T) => string = () => "", provisional: (value: T) => boolean = () => false) {
    const cells = new Map<string, Cell<T>>()
    const queues = new Map<string, Promise<unknown>>()
    let snapshotSequence = 0
    const visible = (cell: Cell<T>) => cell.pending ? cell.pending.value : cell.value
    const values = () => [...cells.values()].flatMap((cell) => { const value = visible(cell); return value === null ? [] : [value] })
    function write(key: string, value: T | null, version = value === null ? "" : versionOf(value)) {
        const cell = cells.get(key)
        if (cell && version && cell.version && (version < cell.version || (value !== null && cell.value === null && version === cell.version))) return
        cells.set(key, { value, revision: tick(), version: version || cell?.version || "", pending: cell?.pending })
    }
    return {
        values,
        write,
        get: (key: string) => { const cell = cells.get(key); return cell ? visible(cell) : null },
        has: (key: string) => cells.has(key),
        prune: (keep: (value: T) => boolean) => {
            for (const [key, cell] of cells) if (cell.value && !keep(cell.value)) cells.delete(key)
        },
        replace(read: ChatRead, incoming: T[]) {
            if (read.sequence < snapshotSequence) return
            snapshotSequence = read.sequence
            const next = new Map(incoming.map((value) => [keyOf(value), value]))
            for (const key of new Set([...cells.keys(), ...next.keys()])) {
                const cell = cells.get(key)
                if (cell && (cell.pending || (cell.readSequence ?? 0) > read.sequence || cell.revision > read.revision || (cell.value && provisional(cell.value)))) continue
                const value = next.get(key) ?? null
                cells.set(key, { value, revision: read.revision, readSequence: read.sequence, version: value === null ? cell?.version ?? "" : versionOf(value) })
            }
        },
        mergeRead(read: ChatRead, incoming: T[], acknowledgement = false) {
            if (!acknowledgement && read.sequence < snapshotSequence) return [] as T[]
            const accepted: T[] = []
            for (const value of incoming) {
                const key = keyOf(value), cell = cells.get(key)
                if (cell && (cell.pending || (!acknowledgement && (cell.readSequence ?? 0) > read.sequence) || cell.revision > read.revision)) continue
                cells.set(key, { value, revision: acknowledgement ? tick() : read.revision, readSequence: read.sequence, version: versionOf(value) })
                accepted.push(value)
            }
            return accepted
        },
        async mutate(key: string, desired: T | null, request: () => Promise<T | null>, publish: () => void) {
            // Serialise writes to one record. Different records remain independent.
            const previous = queues.get(key)
            const run = async () => {
                const cell = cells.get(key) ?? { value: null, revision: tick(), version: "" }
                cell.pending = { value: desired }
                cell.revision = tick()
                cells.set(key, cell)
                publish()
                try {
                    const saved = await request()
                    const current = cells.get(key)
                    if (current) {
                        const version = saved === null ? "" : versionOf(saved)
                        // A newer live reaction may arrive before this response.
                        if (!version || !current.version || version > current.version || (version === current.version && current.value !== null)) {
                            current.value = saved
                            current.version = version || current.version
                        }
                    }
                } catch (error) {
                    // A lost acknowledgement is not a confirmed rejection. Keep the
                    // intent until a read begun after this request resolves it.
                    const current = cells.get(key)
                    if (current && (!(error instanceof ChatMutationError) || error.uncertain)) current.value = desired
                    throw error
                } finally {
                    const current = cells.get(key)
                    if (current) { delete current.pending; current.revision = tick() }
                    publish()
                }
            }
            const pending = previous ? previous.catch(() => undefined).then(run) : run()
            queues.set(key, pending)
            try { await pending } finally { if (queues.get(key) === pending) queues.delete(key) }
        },
    }
}

export function createCoordinatedChat<M extends Message, C extends Conversation<M>, R extends Reaction>(
    initial: { conversations: C[]; reactions: R[] },
    reactionKey: (reaction: R) => string,
) {
    let revision = 0, sequence = 0, appliedSnapshot = 0
    const tick = () => ++revision
    const messages = collection<M>((message) => message.id, tick, (message) => (message as M & { editedAt?: string | null }).editedAt ?? "", (message) => message.id === message.clientRequestId)
    const reactions = collection<R>(reactionKey, tick, (reaction) => reaction.updatedAt)
    const pins = collection<{ id: string; messageId: string | null }>((pin) => pin.id, tick)
    const owners = new Map<string, string>()
    let metadata = initial.conversations
    const listeners = new Set<() => void>()
    let state = initial
    const ingestMessages = (conversations: C[]) => {
        for (const conversation of conversations) for (const message of conversation.messages) owners.set(message.id, conversation.id)
    }
    ingestMessages(initial.conversations)
    for (const conversation of initial.conversations) {
        for (const message of conversation.messages) messages.write(message.id, message)
        pins.write(conversation.id, { id: conversation.id, messageId: conversation.pinnedMessageId })
    }
    for (const reaction of initial.reactions) reactions.write(reactionKey(reaction), reaction)

    function publish() {
        const allowed = new Set(metadata.map((conversation) => conversation.id))
        const durableRequests = new Set(messages.values().filter((message) => message.id !== message.clientRequestId).map((message) => message.clientRequestId))
        for (const message of messages.values()) if (message.id === message.clientRequestId && durableRequests.has(message.clientRequestId)) messages.write(message.id, null)
        const grouped = new Map<string, Map<string, M>>()
        for (const message of messages.values()) {
            const owner = owners.get(message.id)
            if (!owner || !allowed.has(owner)) continue
            const group = grouped.get(owner) ?? new Map<string, M>()
            const key = message.clientRequestId ?? message.id
            const existing = group.get(key)
            if (!existing || message.id !== message.clientRequestId) group.set(key, message)
            grouped.set(owner, group)
        }
        const conversations = metadata.map((conversation) => {
            const rows = [...(grouped.get(conversation.id)?.values() ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            const pinnedMessageId = pins.get(conversation.id)?.messageId ?? null
            return { ...conversation, messages: rows, pinnedMessageId: pinnedMessageId && messages.has(pinnedMessageId) && !messages.get(pinnedMessageId) ? null : pinnedMessageId }
        })
        conversations.sort((left, right) => (right.messages.at(-1)?.createdAt ?? right.updatedAt ?? "").localeCompare(left.messages.at(-1)?.createdAt ?? left.updatedAt ?? "") || (left.title ?? "").localeCompare(right.title ?? ""))
        const visibleReactions = reactions.values().filter((reaction) => allowed.has(owners.get(reaction.messageId) ?? "") && (!messages.has(reaction.messageId) || messages.get(reaction.messageId)))
        state = { conversations, reactions: visibleReactions }
        listeners.forEach((listener) => listener())
    }
    return {
        getSnapshot: () => state,
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
        beginRead: (): ChatRead => ({ revision, sequence: ++sequence }),
        applySnapshot(read: ChatRead, incoming: { conversations: C[]; reactions: R[] }) {
            if (read.sequence < appliedSnapshot) return false
            appliedSnapshot = read.sequence
            metadata = incoming.conversations // Access and membership always come from the server.
            ingestMessages(incoming.conversations)
            messages.replace(read, incoming.conversations.flatMap((conversation) => conversation.messages))
            reactions.replace(read, incoming.reactions)
            pins.replace(read, incoming.conversations.map((conversation) => ({ id: conversation.id, messageId: conversation.pinnedMessageId })))
            const allowed = new Set(metadata.map((conversation) => conversation.id))
            messages.prune((message) => allowed.has(owners.get(message.id) ?? ""))
            reactions.prune((reaction) => allowed.has(owners.get(reaction.messageId) ?? ""))
            publish()
            return true
        },
        mergeReadMessages(read: ChatRead, conversationId: string, incoming: M[], acknowledgement = false) {
            for (const message of incoming) owners.set(message.id, conversationId)
            const accepted = messages.mergeRead(read, incoming, acknowledgement)
            publish()
            return accepted
        },
        setConversations(update: Setter<C[]>) {
            const incoming = typeof update === "function" ? update(state.conversations) : update
            const previous = new Map(state.conversations.map((conversation) => [conversation.id, conversation]))
            for (const conversation of incoming) {
                const old = previous.get(conversation.id)
                if (!old || old.pinnedMessageId !== conversation.pinnedMessageId) pins.write(conversation.id, { id: conversation.id, messageId: conversation.pinnedMessageId })
                const byId = new Map(old?.messages.map((message) => [message.id, message]))
                for (const message of conversation.messages) if (byId.get(message.id) !== message) messages.write(message.id, message)
                const ids = new Set(conversation.messages.map((message) => message.id))
                for (const message of old?.messages ?? []) if (!ids.has(message.id)) messages.write(message.id, null)
            }
            metadata = incoming
            ingestMessages(incoming)
            publish()
        },
        removeMessage(messageId: string) { messages.write(messageId, null); publish() },
        receiveReaction(key: string, value: R | null, version?: string) { reactions.write(key, value, version); publish() },
        mutateReaction: (key: string, desired: R | null, request: () => Promise<R | null>) => reactions.mutate(key, desired, request, publish),
        mutatePin: (conversationId: string, messageId: string | null, request: () => Promise<void>) => pins.mutate(conversationId, { id: conversationId, messageId }, async () => { await request(); return { id: conversationId, messageId } }, publish),
        mutateMessage: (messageId: string, desired: M | null, request: () => Promise<M | null>) => messages.mutate(messageId, desired, request, publish),
    }
}

/** Parse acknowledgements consistently; distinguish rejection from uncertainty. */
export async function chatMutationRequest<T>(url: string, init: RequestInit): Promise<T> {
    let response: Response
    try { response = await fetch(url, init) } catch { throw new ChatMutationError("Could not confirm the change. Checking for updates…", true) }
    const result = await response.json().catch(() => null) as (T & { error?: string }) | null
    if (!response.ok) throw new ChatMutationError(result?.error ?? "Could not save the change.", response.status >= 500)
    if (!result) throw new ChatMutationError("Could not confirm the change. Checking for updates…", true)
    return result
}
