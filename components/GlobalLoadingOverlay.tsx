"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { LoadingOverlay } from "@/components/LoadingOverlay"
import { WORKSPACE_TAB_FRAME_PARAM } from "@/lib/workspace-tabs"
import { WORKSPACE_BACKGROUND_INTENT_END, WORKSPACE_BACKGROUND_INTENT_START } from "@/lib/workspace-background"

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

function mutationCategory(pathname: string) {
    const section = pathname.split("/").filter(Boolean)[1] ?? ""
    if (section === "onboarding" || section === "onboarding-builder") return "onboarding"
    if (section === "leadgen") return "leadgen"
    if (section === "communications") return "communications"
    if (section === "work" || section === "work-items") return "gantt"
    if (section === "settings") return "system"
    if (section === "relationships") return "services"
    if (section === "admin") return "maintenance"
    return "system"
}

function requestUrl(input: RequestInfo | URL) {
    if (input instanceof Request) return new URL(input.url, window.location.href)
    return new URL(String(input), window.location.href)
}

export function GlobalLoadingOverlay() {
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const currentRouteKey = `${pathname}?${searchParams.toString()}`
    const [loadingRouteKey, setLoadingRouteKey] = useState<string | null>(null)
    const previousRouteKey = useRef(currentRouteKey)
    const backgroundIntentCountRef = useRef(0)

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
            if (
                form?.dataset.workspaceAutosave !== "true" &&
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
        window.addEventListener(WORKSPACE_BACKGROUND_INTENT_START, beginBackgroundIntent)
        window.addEventListener(WORKSPACE_BACKGROUND_INTENT_END, endBackgroundIntent)
        window.fetch = async (...args) => {
            const [input, init] = args
            const headers = new Headers(
                init?.headers ?? (input instanceof Request ? input.headers : undefined)
            )
            const isServerAction = headers.has("Next-Action")
            const embedded = window.self !== window.top
            const workspaceFrame = embedded && new URLSearchParams(window.location.search).has(WORKSPACE_TAB_FRAME_PARAM)
            const workspaceShell = Boolean(document.querySelector("[data-workspace-shell-root]"))
            const url = requestUrl(input)
            const method = String(init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase()
            const mutation = (workspaceFrame || workspaceShell)
                && ["POST", "PUT", "PATCH", "DELETE"].includes(method)
                && !url.pathname.endsWith("/activity/mutations")
            const backgroundMutation = mutation && backgroundIntentCountRef.current > 0
            const startedAt = performance.now()
            const requestId = mutation ? crypto.randomUUID() : ""

            const reportMutation = (failed: boolean, status: number, aborted = false) => {
                if (!mutation) return
                if (backgroundMutation) window.dispatchEvent(new CustomEvent("betelgeze:workspace-mutation-end", { detail: { failed } }))
                const workspaceSlug = window.location.pathname.split("/").filter(Boolean)[0] ?? ""
                if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(workspaceSlug)) return
                const sameOrigin = url.origin === window.location.origin
                const path = sameOrigin ? url.pathname : `/external/${url.hostname}${url.pathname}`
                void originalFetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/activity/mutations`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        requestId,
                        method,
                        path,
                        category: mutationCategory(window.location.pathname),
                        status,
                        durationMs: performance.now() - startedAt,
                        background: backgroundMutation,
                        failed,
                        aborted,
                    }),
                    keepalive: true,
                }).catch(() => undefined)
            }

            if (backgroundMutation) {
                window.dispatchEvent(new Event("betelgeze:workspace-mutation-start"))
            } else if (isServerAction) {
                if (embedded) window.dispatchEvent(new Event("betelgeze:workspace-action-start"))
                else setLoadingRouteKey(currentRouteKey)
            }

            try {
                const response = await originalFetch(...args)
                reportMutation(!response.ok, response.status)
                return response
            } catch (error) {
                reportMutation(!(error instanceof DOMException && error.name === "AbortError"), 0, error instanceof DOMException && error.name === "AbortError")
                throw error
            } finally {
                if (isServerAction && !backgroundMutation) {
                    if (embedded) window.dispatchEvent(new Event("betelgeze:workspace-action-end"))
                    else setLoadingRouteKey(null)
                }
            }
        }

        return () => {
            window.fetch = originalFetch
            window.removeEventListener(WORKSPACE_BACKGROUND_INTENT_START, beginBackgroundIntent)
            window.removeEventListener(WORKSPACE_BACKGROUND_INTENT_END, endBackgroundIntent)
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
