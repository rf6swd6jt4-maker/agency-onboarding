export const ONBOARDING_BUILDER_WINDOW_SOURCE = "betelgeze-onboarding-builder-window"
export const ONBOARDING_BUILDER_WINDOW_TTL_MS = 15_000

export type OnboardingBuilderWindowSignal = {
    source: typeof ONBOARDING_BUILDER_WINDOW_SOURCE
    workspaceSlug: string
    type: "opened" | "heartbeat" | "closed" | "probe" | "return"
    updatedAt: number
}

type OnboardingBuilderWindowPresence = {
    open: boolean
    updatedAt: number
}

export function onboardingBuilderWindowChannelName(workspaceSlug: string) {
    return `${ONBOARDING_BUILDER_WINDOW_SOURCE}:${workspaceSlug}`
}

export function onboardingBuilderWindowStorageKey(workspaceSlug: string) {
    return `${ONBOARDING_BUILDER_WINDOW_SOURCE}:${workspaceSlug}:presence`
}

export function onboardingBuilderWindowName(workspaceSlug: string) {
    return `betelgeze-onboarding-builder-${workspaceSlug.replace(/[^a-z0-9_-]/gi, "-")}`
}

export function onboardingBuilderWindowIsFresh(value: unknown, now = Date.now()) {
    if (!value || typeof value !== "object") return false
    const presence = value as Partial<OnboardingBuilderWindowPresence>
    return presence.open === true
        && typeof presence.updatedAt === "number"
        && now - presence.updatedAt < ONBOARDING_BUILDER_WINDOW_TTL_MS
}

export function readOnboardingBuilderWindowPresence(workspaceSlug: string) {
    try {
        const raw = window.localStorage.getItem(onboardingBuilderWindowStorageKey(workspaceSlug))
        return raw ? onboardingBuilderWindowIsFresh(JSON.parse(raw)) : false
    } catch {
        return false
    }
}

export function publishOnboardingBuilderWindowSignal(workspaceSlug: string, type: OnboardingBuilderWindowSignal["type"]) {
    const signal: OnboardingBuilderWindowSignal = {
        source: ONBOARDING_BUILDER_WINDOW_SOURCE,
        workspaceSlug,
        type,
        updatedAt: Date.now(),
    }

    if (type !== "probe" && type !== "return") {
        try {
            window.localStorage.setItem(onboardingBuilderWindowStorageKey(workspaceSlug), JSON.stringify({
                open: type !== "closed",
                updatedAt: signal.updatedAt,
            } satisfies OnboardingBuilderWindowPresence))
        } catch {
            // BroadcastChannel still keeps same-origin tabs coordinated when
            // storage is unavailable (for example, in stricter privacy modes).
        }
    }

    if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel(onboardingBuilderWindowChannelName(workspaceSlug))
        channel.postMessage(signal)
        channel.close()
    }

    return signal
}

export function openOnboardingBuilderWindow(href: string, workspaceSlug: string) {
    const builderWindow = window.open(href, onboardingBuilderWindowName(workspaceSlug))
    if (!builderWindow) return null
    publishOnboardingBuilderWindowSignal(workspaceSlug, "opened")
    builderWindow.focus()
    return builderWindow
}

export function returnFromOnboardingBuilder(workspaceSlug: string, fallbackHref: string) {
    publishOnboardingBuilderWindowSignal(workspaceSlug, "closed")
    const message = publishOnboardingBuilderWindowSignal(workspaceSlug, "return")
    const appWindow = window.opener && !window.opener.closed ? window.opener.top : null
    appWindow?.postMessage(message, window.location.origin)
    appWindow?.focus()
    window.close()

    // Browsers only permit scripts to close windows that were script-opened.
    // If this Builder URL was opened manually, return in the current tab.
    window.setTimeout(() => window.location.assign(fallbackHref), 150)
}
