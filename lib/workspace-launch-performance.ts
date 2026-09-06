import type { WorkspaceShellBootstrapTiming } from "@/lib/workspace-launch"

type LaunchMark = "client_bootstrap_ms" | "shell_hydrated_ms" | "initial_frame_mounted_ms" | "initial_frame_loaded_ms" | "panel_ready_ms" | "presence_ready_ms"

type LaunchPerformanceState = {
    id: string
    marks: Partial<Record<LaunchMark, number>>
    reportedStages: string[]
    lcpMs?: number
    lcpObserver?: PerformanceObserver
}

declare global {
    interface Window {
        __BETELGEZE_LAUNCH_PERFORMANCE__?: LaunchPerformanceState
    }
}

function topLevelWindow() {
    return typeof window !== "undefined" && window.self === window.top
}

export function initializeWorkspaceLaunchPerformance() {
    if (!topLevelWindow()) return null
    const existing = window.__BETELGEZE_LAUNCH_PERFORMANCE__
    if (existing) return existing
    const state: LaunchPerformanceState = {
        id: crypto.randomUUID(),
        marks: { client_bootstrap_ms: Math.max(0, performance.now()) },
        reportedStages: [],
    }
    if (typeof PerformanceObserver !== "undefined") {
        try {
            state.lcpObserver = new PerformanceObserver((list) => {
                const entries = list.getEntries()
                const latest = entries[entries.length - 1]
                if (latest) state.lcpMs = Math.max(0, latest.startTime)
            })
            state.lcpObserver.observe({ type: "largest-contentful-paint", buffered: true })
        } catch {
            state.lcpObserver = undefined
        }
    }
    window.__BETELGEZE_LAUNCH_PERFORMANCE__ = state
    return state
}

export function markWorkspaceLaunch(name: LaunchMark) {
    const state = initializeWorkspaceLaunchPerformance()
    if (!state || state.marks[name] !== undefined) return
    state.marks[name] = Math.max(0, performance.now())
}

function paintTiming(name: "first-contentful-paint") {
    const entries = performance.getEntriesByName(name)
    return entries.length ? entries[entries.length - 1].startTime : undefined
}

function navigationTiming() {
    return performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined
}

function displayMode() {
    if (window.matchMedia("(display-mode: standalone)").matches) return "standalone"
    if ((navigator as Navigator & { standalone?: boolean }).standalone) return "standalone-ios"
    return "browser"
}

function deviceClass() {
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
    const cores = navigator.hardwareConcurrency || 0
    if ((memory && memory <= 4) || (cores && cores <= 4)) return "constrained"
    if ((memory && memory >= 8) || cores >= 8) return "high"
    return "standard"
}

function routeSection(value: string, workspaceSlug: string) {
    try {
        const segments = new URL(value, window.location.origin).pathname.split("/").filter(Boolean)
        return segments[0] === workspaceSlug ? segments[1] || "workspace" : "workspace"
    } catch {
        return "workspace"
    }
}

export function reportWorkspaceLaunch(input: {
    stage: "usable" | "presence"
    workspaceSlug: string
    initialUrl: string
    serverTiming?: WorkspaceShellBootstrapTiming
}) {
    const state = initializeWorkspaceLaunchPerformance()
    if (!state || state.reportedStages.includes(input.stage)) return
    state.reportedStages.push(input.stage)
    const navigation = navigationTiming()
    const proxyTiming = navigation?.serverTiming?.find((entry) => entry.name === "proxy-session")?.duration
    const timings: Record<string, number> = { ...state.marks }
    if (navigation?.responseStart !== undefined) timings.ttfb_ms = navigation.responseStart
    const fcp = paintTiming("first-contentful-paint")
    const lcp = state.lcpMs
    if (fcp !== undefined) timings.fcp_ms = fcp
    if (lcp !== undefined) timings.lcp_ms = lcp
    if (proxyTiming !== undefined) timings.proxy_session_ms = proxyTiming
    if (input.serverTiming) {
        timings.server_auth_ms = input.serverTiming.authMs
        timings.server_bootstrap_ms = input.serverTiming.bootstrapMs
        timings.server_total_ms = input.serverTiming.totalMs
        timings.server_bootstrap_fallback = input.serverTiming.fallback ? 1 : 0
    }
    const connection = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection
    const body = JSON.stringify({
        launchId: state.id,
        routeSection: routeSection(input.initialUrl, input.workspaceSlug),
        navigationType: navigation?.type ?? "navigate",
        displayMode: displayMode(),
        connectionType: connection?.effectiveType ?? null,
        deviceClass: deviceClass(),
        timings,
        frameCount: document.querySelectorAll("[data-workspace-tab-panels] iframe").length,
    })
    const endpoint = `/api/workspaces/${encodeURIComponent(input.workspaceSlug)}/performance/launch`
    if (navigator.sendBeacon && navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }))) return
    void fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => undefined)
}
