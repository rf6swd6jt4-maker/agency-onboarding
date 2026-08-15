"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { LoadingOverlay } from "@/components/LoadingOverlay"
import { WORKSPACE_TAB_FRAME_PARAM } from "@/lib/workspace-tabs"
import {
    reportWorkspaceMutation,
    WORKSPACE_MUTATION_END,
    WORKSPACE_MUTATION_INTENT_END,
    WORKSPACE_MUTATION_INTENT_START,
    WORKSPACE_MUTATION_START,
    type WorkspaceMutationEventDetail,
} from "@/lib/workspace-mutations"

function isWorkspaceFrame() {
    return window.self !== window.top && new URLSearchParams(window.location.search).has(WORKSPACE_TAB_FRAME_PARAM)
}

function requestUrl(input: RequestInfo | URL) {
    if (input instanceof Request) return new URL(input.url, window.location.href)
    return new URL(String(input), window.location.href)
}

function shouldIgnoreClick(event: MouseEvent) {
    if (window.self !== window.top || new URLSearchParams(window.location.search).has(WORKSPACE_TAB_FRAME_PARAM)) return true
    if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
    ) {
        return true
    }

    const target = event.target as Element | null
    const link = target?.closest("a[href]") as HTMLAnchorElement | null

    if (!link) return true
    if (link.target && link.target !== "_self") return true
    if (link.dataset.globalLoading === "false") return true

    const href = link.getAttribute("href")

    if (!href || href.startsWith("#") || href.startsWith("mailto:")) {
        return true
    }

    const nextUrl = new URL(href, window.location.href)

    return (
        nextUrl.origin !== window.location.origin ||
        nextUrl.href === window.location.href
    )
}

export function GlobalLoadingOverlay() {
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const currentRouteKey = `${pathname}?${searchParams.toString()}`
    const [loadingRouteKey, setLoadingRouteKey] = useState<string | null>(null)
    const previousRouteKey = useRef(currentRouteKey)
    const backgroundIntentCountRef = useRef(0)
    const backgroundFormIntentCountRef = useRef(0)

    useEffect(() => {
        function handleClick(event: MouseEvent) {
            if (!shouldIgnoreClick(event)) {
                setLoadingRouteKey(currentRouteKey)
            }
        }

        function handlePageShow() {
            setLoadingRouteKey(null)
        }

        document.addEventListener("click", handleClick, true)
        const handleSubmit = (event: SubmitEvent) => {
            const form = event.target as HTMLFormElement | null
            const workspaceScoped = isWorkspaceFrame() || Boolean(form?.closest("[data-workspace-shell-root]"))
            if (workspaceScoped && form?.dataset.workspaceMutation === "background") {
                backgroundFormIntentCountRef.current += 1
                return
            }
            if (
                form?.dataset.globalLoading !== "false" &&
                form?.getAttribute("action")
            ) {
                setLoadingRouteKey(currentRouteKey)
            }
        }
        document.addEventListener("submit", handleSubmit, true)
        window.addEventListener("pageshow", handlePageShow)
        window.addEventListener("betelgeze:clear-loading", handlePageShow)

        return () => {
            document.removeEventListener("click", handleClick, true)
            document.removeEventListener("submit", handleSubmit, true)
            window.removeEventListener("pageshow", handlePageShow)
            window.removeEventListener("betelgeze:clear-loading", handlePageShow)
        }
    }, [currentRouteKey])

    useEffect(() => {
        const originalFetch = window.fetch
        const beginBackgroundIntent = () => { backgroundIntentCountRef.current += 1 }
        const endBackgroundIntent = () => { backgroundIntentCountRef.current = Math.max(0, backgroundIntentCountRef.current - 1) }
        window.addEventListener(WORKSPACE_MUTATION_INTENT_START, beginBackgroundIntent)
        window.addEventListener(WORKSPACE_MUTATION_INTENT_END, endBackgroundIntent)
        window.fetch = async (...args) => {
            const [input, init] = args
            const headers = new Headers(
                init?.headers ?? (input instanceof Request ? input.headers : undefined)
            )
            const isServerAction = headers.has("Next-Action")
            const embedded = window.self !== window.top
            const workspaceFrame = isWorkspaceFrame()
            const workspaceShell = Boolean(document.querySelector("[data-workspace-shell-root]"))
            const url = requestUrl(input)
            const method = String(init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase()
            const sameOrigin = url.origin === window.location.origin
            const workspaceMutation = (workspaceFrame || workspaceShell)
                && sameOrigin
                && ["POST", "PUT", "PATCH", "DELETE"].includes(method)
                && !url.pathname.includes("/activity/")
            const wrappedMutation = workspaceMutation && backgroundIntentCountRef.current > 0
            const backgroundFormMutation = workspaceMutation && !wrappedMutation && backgroundFormIntentCountRef.current > 0
            const backgroundMutation = wrappedMutation || backgroundFormMutation
            const requestId = workspaceMutation && !wrappedMutation ? crypto.randomUUID() : ""
            const startedAt = performance.now()

            if (backgroundFormMutation) {
                window.dispatchEvent(new CustomEvent<WorkspaceMutationEventDetail>(WORKSPACE_MUTATION_START, {
                    detail: { mutationId: requestId, failed: false },
                }))
            } else if (isServerAction && !backgroundMutation) {
                if (embedded) window.dispatchEvent(new Event("betelgeze:workspace-action-start"))
                else setLoadingRouteKey(currentRouteKey)
            }

            try {
                const response = await originalFetch(...args)
                if (workspaceMutation && !wrappedMutation) {
                    const failed = !response.ok
                    if (backgroundFormMutation) {
                        window.dispatchEvent(new CustomEvent<WorkspaceMutationEventDetail>(WORKSPACE_MUTATION_END, {
                            detail: { mutationId: requestId, failed },
                        }))
                    }
                    void reportWorkspaceMutation({
                        mutationId: requestId,
                        method,
                        path: `${url.pathname}${url.search}`,
                        failed,
                        background: backgroundFormMutation,
                        status: response.status,
                        durationMs: performance.now() - startedAt,
                    }).catch(() => undefined)
                }
                return response
            } catch (error) {
                if (workspaceMutation && !wrappedMutation) {
                    const aborted = error instanceof DOMException && error.name === "AbortError"
                    if (backgroundFormMutation) {
                        window.dispatchEvent(new CustomEvent<WorkspaceMutationEventDetail>(WORKSPACE_MUTATION_END, {
                            detail: { mutationId: requestId, failed: !aborted, error: aborted ? undefined : "Network request failed" },
                        }))
                    }
                    void reportWorkspaceMutation({
                        mutationId: requestId,
                        method,
                        path: `${url.pathname}${url.search}`,
                        failed: !aborted,
                        aborted,
                        background: backgroundFormMutation,
                        status: 0,
                        durationMs: performance.now() - startedAt,
                    }).catch(() => undefined)
                }
                throw error
            } finally {
                if (isServerAction && !backgroundMutation) {
                    if (embedded) window.dispatchEvent(new Event("betelgeze:workspace-action-end"))
                    else setLoadingRouteKey(null)
                }
                if (backgroundFormMutation) backgroundFormIntentCountRef.current = Math.max(0, backgroundFormIntentCountRef.current - 1)
            }
        }

        return () => {
            window.fetch = originalFetch
            window.removeEventListener(WORKSPACE_MUTATION_INTENT_START, beginBackgroundIntent)
            window.removeEventListener(WORKSPACE_MUTATION_INTENT_END, endBackgroundIntent)
        }
    }, [currentRouteKey])

    useEffect(() => {
        if (previousRouteKey.current !== currentRouteKey) {
            previousRouteKey.current = currentRouteKey
            setLoadingRouteKey(null)
        }
    }, [currentRouteKey])

    useEffect(() => {
        if (!loadingRouteKey) return

        const timeout = window.setTimeout(() => {
            setLoadingRouteKey(null)
        }, 8000)

        return () => window.clearTimeout(timeout)
    }, [loadingRouteKey])

    return loadingRouteKey === currentRouteKey ? <LoadingOverlay /> : null
}
