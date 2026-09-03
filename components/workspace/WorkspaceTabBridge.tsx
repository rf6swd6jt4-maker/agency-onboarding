"use client"

import { useEffect, useRef } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
    isWorkspaceOnboardingBuilderUrl,
    isReopenClosedTabShortcut,
    normalizeWorkspaceUrl,
    WORKSPACE_TAB_FRAME_PARAM,
    WORKSPACE_TAB_MESSAGE_SOURCE,
    workspaceTabFrameUrl,
    workspaceRouteIsRecordDetail,
    type WorkspaceTabFrameMessage,
    type WorkspaceTabParentMessage,
} from "@/lib/workspace-tabs"
import { WORKSPACE_TAB_VISIBILITY_EVENT } from "@/components/workspace/useWorkspaceTabActive"
import { openOnboardingBuilderWindow } from "@/lib/onboarding-builder-window"
import {
    flushWorkspaceAutosaves,
    WORKSPACE_MUTATION_END,
    WORKSPACE_MUTATION_START,
    type WorkspaceMutationEventDetail,
} from "@/lib/workspace-mutations"

type Props = {
    tabId: string
    workspaceSlug: string
}

export function WorkspaceTabBridge({ tabId, workspaceSlug }: Props) {
    const pathname = usePathname()
    const router = useRouter()
    const searchParams = useSearchParams()
    const startedPollNoticeRef = useRef("")

    useEffect(() => {
        function reportLocation() {
            const params = new URLSearchParams(searchParams.toString())
            params.delete("pollStarted")
            const query = params.toString()
            const url = normalizeWorkspaceUrl(`${pathname}${query ? `?${query}` : ""}${window.location.hash}`, workspaceSlug, window.location.origin)
            const message: WorkspaceTabFrameMessage = {
                source: WORKSPACE_TAB_MESSAGE_SOURCE,
                target: "host",
                tabId,
                type: "location",
                url,
            }
            window.parent.postMessage(message, window.location.origin)
        }

        reportLocation()
        window.addEventListener("hashchange", reportLocation)
        return () => window.removeEventListener("hashchange", reportLocation)
    }, [pathname, searchParams, tabId, workspaceSlug])

    useEffect(() => {
        const pollId = searchParams.get("pollStarted")
        if (!pollId) return
        const key = `${pathname}:${pollId}`
        if (startedPollNoticeRef.current === key) return
        startedPollNoticeRef.current = key

        const message: WorkspaceTabFrameMessage = {
            source: WORKSPACE_TAB_MESSAGE_SOURCE,
            target: "host",
            tabId,
            type: "poll-started",
            pollId,
        }
        window.parent.postMessage(message, window.location.origin)

        const current = new URL(window.location.href)
        current.searchParams.delete("pollStarted")
        window.history.replaceState(window.history.state, "", `${current.pathname}${current.search}${current.hash}`)
    }, [pathname, searchParams, tabId])

    useEffect(() => {
        let contextObstructed = false

        function reportContextObstruction(nextObstructed: boolean) {
            if (contextObstructed === nextObstructed) return
            contextObstructed = nextObstructed
            const message: WorkspaceTabFrameMessage = {
                source: WORKSPACE_TAB_MESSAGE_SOURCE,
                target: "host",
                tabId,
                type: "context-obstruction",
                contextObstructed: nextObstructed,
            }
            window.parent.postMessage(message, window.location.origin)
        }

        function updateContextObstruction() {
            reportContextObstruction(Boolean(document.querySelector("[data-loading-overlay]")))
        }

        function reportNavigationStart(url: string) {
            const message: WorkspaceTabFrameMessage = {
                source: WORKSPACE_TAB_MESSAGE_SOURCE,
                target: "host",
                tabId,
                type: "navigation-start",
                url: normalizeWorkspaceUrl(url, workspaceSlug, window.location.origin),
            }
            window.parent.postMessage(message, window.location.origin)
        }

        async function preserveFrameNavigation(event: MouseEvent) {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
            const target = event.target
            if (!(target instanceof Element)) return
            const anchor = target.closest("a[href]") as HTMLAnchorElement | null
            if (!anchor || anchor.hasAttribute("download")) return
            if (anchor.getAttribute("aria-disabled") === "true") {
                event.preventDefault()
                return
            }
            const destination = new URL(anchor.href, window.location.href)
            if (destination.origin !== window.location.origin || destination.searchParams.has(WORKSPACE_TAB_FRAME_PARAM)) return
            const nextUrl = `${destination.pathname}${destination.search}${destination.hash}`
            if (isWorkspaceOnboardingBuilderUrl(nextUrl, workspaceSlug, window.location.origin)) {
                event.preventDefault()
                openOnboardingBuilderWindow(nextUrl, workspaceSlug)
                window.dispatchEvent(new Event("betelgeze:workspace-navigation-start"))
                reportNavigationStart(nextUrl)
                await flushWorkspaceAutosaves()
                router.push(workspaceTabFrameUrl(nextUrl, tabId, window.location.origin))
                return
            }
            if (anchor.target === "_blank") return
            const currentUrl = normalizeWorkspaceUrl(`${window.location.pathname}${window.location.search}${window.location.hash}`, workspaceSlug, window.location.origin)
            if (normalizeWorkspaceUrl(nextUrl, workspaceSlug, window.location.origin) === currentUrl) return
            if (workspaceRouteIsRecordDetail(nextUrl, workspaceSlug, window.location.origin)) {
                event.preventDefault()
                const message: WorkspaceTabFrameMessage = {
                    source: WORKSPACE_TAB_MESSAGE_SOURCE,
                    target: "host",
                    tabId,
                    type: "open-tab",
                    url: nextUrl,
                }
                window.parent.postMessage(message, window.location.origin)
                return
            }
            event.preventDefault()
            // Stop page-local refreshers before starting the App Router
            // transition. The host retains a delayed hard-navigation fallback
            // in case a streamed transition cannot complete.
            window.dispatchEvent(new Event("betelgeze:workspace-navigation-start"))
            reportNavigationStart(nextUrl)
            await flushWorkspaceAutosaves()
            router.push(workspaceTabFrameUrl(nextUrl, tabId, window.location.origin))
        }

        async function receiveHostMessage(event: MessageEvent<WorkspaceTabParentMessage>) {
            if (event.origin !== window.location.origin) return
            const message = event.data
            if (message?.source !== WORKSPACE_TAB_MESSAGE_SOURCE || message.target !== "frame" || message.tabId !== tabId) return

            if (message.type === "navigate" && message.url) {
                const target = workspaceTabFrameUrl(message.url, tabId, window.location.origin)
                const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
                if (target !== current) {
                    window.dispatchEvent(new Event("betelgeze:workspace-navigation-start"))
                    await flushWorkspaceAutosaves()
                    router.push(target)
                }
            } else if (message.type === "traverse" && message.url) {
                window.dispatchEvent(new Event("betelgeze:clear-loading"))
                const target = workspaceTabFrameUrl(message.url, tabId, window.location.origin)
                const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
                if (target !== current) {
                    window.dispatchEvent(new Event("betelgeze:workspace-navigation-start"))
                    await flushWorkspaceAutosaves()
                    router.replace(target)
                }
            } else if (message.type === "activate") {
                document.body.dataset.workspaceTabActive = message.active ? "true" : "false"
                window.dispatchEvent(new Event(WORKSPACE_TAB_VISIBILITY_EVENT))
                if (!message.active) await flushWorkspaceAutosaves()
                if (message.active && message.refresh) window.location.reload()
            }
        }

        function reportPossibleMutation(event?: Event) {
            if (event?.target instanceof HTMLFormElement && event.target.dataset.workspaceMutationScope === "local") return
            const message: WorkspaceTabFrameMessage = {
                source: WORKSPACE_TAB_MESSAGE_SOURCE,
                target: "host",
                tabId,
                type: "mutation",
            }
            window.parent.postMessage(message, window.location.origin)
        }

        function reportActionState(type: "action-start" | "action-end") {
            const message: WorkspaceTabFrameMessage = {
                source: WORKSPACE_TAB_MESSAGE_SOURCE,
                target: "host",
                tabId,
                type,
            }
            window.parent.postMessage(message, window.location.origin)
        }

        const reportActionStart = () => reportActionState("action-start")
        const reportActionEnd = () => reportActionState("action-end")
        const reportMutationStart = (event: Event) => {
            const detail = (event as CustomEvent<WorkspaceMutationEventDetail>).detail
            const message: WorkspaceTabFrameMessage = {
                source: WORKSPACE_TAB_MESSAGE_SOURCE,
                target: "host",
                tabId,
                type: "mutation-start",
                mutationId: detail?.mutationId,
            }
            window.parent.postMessage(message, window.location.origin)
        }
        const reportMutationEnd = (event: Event) => {
            const detail = (event as CustomEvent<WorkspaceMutationEventDetail>).detail
            const message: WorkspaceTabFrameMessage = {
                source: WORKSPACE_TAB_MESSAGE_SOURCE,
                target: "host",
                tabId,
                type: "mutation-end",
                mutationId: detail?.mutationId,
                mutationFailed: detail?.failed === true,
                mutationError: detail?.error,
            }
            window.parent.postMessage(message, window.location.origin)
        }

        function forwardTabShortcut(event: KeyboardEvent) {
            if (!isReopenClosedTabShortcut(event)) return
            event.preventDefault()
            const message: WorkspaceTabFrameMessage = {
                source: WORKSPACE_TAB_MESSAGE_SOURCE,
                target: "host",
                tabId,
                type: "reopen-closed-tab",
            }
            window.parent.postMessage(message, window.location.origin)
        }

        window.addEventListener("message", receiveHostMessage)
        document.addEventListener("click", preserveFrameNavigation, true)
        document.addEventListener("submit", reportPossibleMutation, true)
        document.addEventListener("keydown", forwardTabShortcut)
        window.addEventListener("betelgeze:workspace-mutation", reportPossibleMutation)
        window.addEventListener("betelgeze:workspace-action-start", reportActionStart)
        window.addEventListener("betelgeze:workspace-action-end", reportActionEnd)
        window.addEventListener(WORKSPACE_MUTATION_START, reportMutationStart)
        window.addEventListener(WORKSPACE_MUTATION_END, reportMutationEnd)
        const observer = new MutationObserver(updateContextObstruction)
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-work-item-popup", "data-loading-overlay"] })
        updateContextObstruction()
        return () => {
            window.removeEventListener("message", receiveHostMessage)
            document.removeEventListener("click", preserveFrameNavigation, true)
            document.removeEventListener("submit", reportPossibleMutation, true)
            document.removeEventListener("keydown", forwardTabShortcut)
            window.removeEventListener("betelgeze:workspace-mutation", reportPossibleMutation)
            window.removeEventListener("betelgeze:workspace-action-start", reportActionStart)
            window.removeEventListener("betelgeze:workspace-action-end", reportActionEnd)
            window.removeEventListener(WORKSPACE_MUTATION_START, reportMutationStart)
            window.removeEventListener(WORKSPACE_MUTATION_END, reportMutationEnd)
            observer.disconnect()
            reportContextObstruction(false)
            delete document.body.dataset.workspaceTabActive
        }
    }, [router, tabId, workspaceSlug])

    return null
}
