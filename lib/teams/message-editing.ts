import type { NativeMessage } from "@/lib/teams/types"

export const NATIVE_MESSAGE_EDIT_WINDOW_MS = 15 * 60 * 1000

export function nativeMessageCanEdit(message: NativeMessage, currentUserId: string, now = Date.now()) {
    const createdAt = Date.parse(message.createdAt)
    const age = now - createdAt
    return message.senderUserId === currentUserId
        && message.clientRequestId !== message.id
        && Boolean(message.body.trim())
        && Number.isFinite(createdAt)
        && age >= 0
        && age <= NATIVE_MESSAGE_EDIT_WINDOW_MS
}
