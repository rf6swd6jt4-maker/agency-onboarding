"use client"

import { useEffect, useState, type MouseEvent, type ReactNode } from "react"
import {
    ONBOARDING_BUILDER_WINDOW_SOURCE,
    onboardingBuilderWindowChannelName,
    onboardingBuilderWindowStorageKey,
    openOnboardingBuilderWindow,
    publishOnboardingBuilderWindowSignal,
    readOnboardingBuilderWindowPresence,
    returnFromOnboardingBuilder,
    type OnboardingBuilderWindowSignal,
} from "@/lib/onboarding-builder-window"

export function OnboardingBuilderLauncher({ workspaceSlug, href, className }: {
    workspaceSlug: string
    href: string
    className: string
}) {
    const [builderOpen, setBuilderOpen] = useState(false)

    useEffect(() => {
        const syncPresence = () => setBuilderOpen(readOnboardingBuilderWindowPresence(workspaceSlug))
        const receiveSignal = (event: MessageEvent<OnboardingBuilderWindowSignal>) => {
            const signal = event.data
            if (signal?.source !== ONBOARDING_BUILDER_WINDOW_SOURCE || signal.workspaceSlug !== workspaceSlug) return
            if (signal.type === "opened" || signal.type === "heartbeat") setBuilderOpen(true)
            if (signal.type === "closed") setBuilderOpen(false)
        }
        const receiveStorage = (event: StorageEvent) => {
            if (event.key === onboardingBuilderWindowStorageKey(workspaceSlug)) syncPresence()
        }
        const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(onboardingBuilderWindowChannelName(workspaceSlug)) : null

        syncPresence()
        channel?.addEventListener("message", receiveSignal)
        window.addEventListener("storage", receiveStorage)
        const staleCheck = window.setInterval(() => {
            syncPresence()
            publishOnboardingBuilderWindowSignal(workspaceSlug, "probe")
        }, 1_000)
        publishOnboardingBuilderWindowSignal(workspaceSlug, "probe")
        return () => {
            window.clearInterval(staleCheck)
            channel?.removeEventListener("message", receiveSignal)
            channel?.close()
            window.removeEventListener("storage", receiveStorage)
        }
    }, [workspaceSlug])

    return <a
        href={href}
        aria-disabled={builderOpen}
        tabIndex={builderOpen ? -1 : undefined}
        aria-label={builderOpen ? "Onboarding Builder is already open" : undefined}
        title={builderOpen ? "Onboarding Builder is already open" : undefined}
        onClick={(event: MouseEvent<HTMLAnchorElement>) => {
            if (event.defaultPrevented) return
            event.preventDefault()
            if (builderOpen) return
            if (openOnboardingBuilderWindow(href, workspaceSlug)) setBuilderOpen(true)
        }}
        className={`${className} ${builderOpen ? "pointer-events-none cursor-default bg-neutral-700 text-neutral-400" : ""}`}
    >
        Open Onboarding Builder
    </a>
}

export function OnboardingBuilderWindowBridge({ workspaceSlug }: { workspaceSlug: string }) {
    useEffect(() => {
        const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(onboardingBuilderWindowChannelName(workspaceSlug)) : null
        const markPresent = () => publishOnboardingBuilderWindowSignal(workspaceSlug, "heartbeat")
        const receiveSignal = (event: MessageEvent<OnboardingBuilderWindowSignal>) => {
            const signal = event.data
            if (signal?.source === ONBOARDING_BUILDER_WINDOW_SOURCE && signal.workspaceSlug === workspaceSlug && signal.type === "probe") markPresent()
        }
        const markClosed = () => publishOnboardingBuilderWindowSignal(workspaceSlug, "closed")

        publishOnboardingBuilderWindowSignal(workspaceSlug, "opened")
        const heartbeat = window.setInterval(markPresent, 1_000)
        channel?.addEventListener("message", receiveSignal)
        window.addEventListener("pagehide", markClosed)
        return () => {
            window.clearInterval(heartbeat)
            channel?.removeEventListener("message", receiveSignal)
            channel?.close()
            window.removeEventListener("pagehide", markClosed)
            markClosed()
        }
    }, [workspaceSlug])

    return null
}

export function BackToBetelgeze({ workspaceSlug, href, className, children }: {
    workspaceSlug: string
    href: string
    className: string
    children?: ReactNode
}) {
    return <button type="button" onClick={() => returnFromOnboardingBuilder(workspaceSlug, href)} className={className}>
        {children ?? "Back to Betelgeze"}
    </button>
}
