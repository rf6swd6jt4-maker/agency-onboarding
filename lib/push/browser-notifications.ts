export async function dismissReadChatNotification(conversationId: string, readThroughCreatedAt: string) {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return

    try {
        const registration = await navigator.serviceWorker.getRegistration("/")
        if (!registration) return
        const notifications = await registration.getNotifications({ tag: `chat:${conversationId}` })
        for (const notification of notifications) {
            const data = notification.data && typeof notification.data === "object"
                ? notification.data as Record<string, unknown>
                : {}
            const messageCreatedAt = typeof data.messageCreatedAt === "string" ? data.messageCreatedAt : null
            if (!messageCreatedAt || messageCreatedAt <= readThroughCreatedAt) notification.close()
        }
    } catch {
        // Notification cleanup is best-effort and must never interrupt read persistence.
    }
}
