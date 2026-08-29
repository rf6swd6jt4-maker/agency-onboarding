import assert from "node:assert/strict"
import test from "node:test"

import { anchoredMessagePaneScrollTop, observeMessagePaneResize } from "../components/communications/message-pane-scroll.ts"

test("latest messages remain absolutely anchored through combined pane and composer resizing", () => {
    assert.equal(anchoredMessagePaneScrollTop({
        scrollHeight: 1_600,
        previousClientHeight: 700,
        nextClientHeight: 360,
        previousScrollTop: 900,
        followingLatest: true,
        preserveVisibleBottom: true,
    }), 1_240)
})

test("resizing preserves the visible bottom when the reader is away from latest", () => {
    assert.equal(anchoredMessagePaneScrollTop({
        scrollHeight: 1_600,
        previousClientHeight: 700,
        nextClientHeight: 620,
        previousScrollTop: 500,
        followingLatest: false,
        preserveVisibleBottom: true,
    }), 580)

    assert.equal(anchoredMessagePaneScrollTop({
        scrollHeight: 1_600,
        previousClientHeight: 620,
        nextClientHeight: 700,
        previousScrollTop: 580,
        followingLatest: false,
        preserveVisibleBottom: true,
    }), 500)
})

test("short conversations stay at their only valid scroll position", () => {
    assert.equal(anchoredMessagePaneScrollTop({
        scrollHeight: 420,
        previousClientHeight: 700,
        nextClientHeight: 620,
        previousScrollTop: 0,
        followingLatest: true,
        preserveVisibleBottom: true,
    }), 0)
})

test("a scroll event cannot consume the composer resize before anchoring runs", () => {
    const originalResizeObserver = globalThis.ResizeObserver
    const originalWindow = globalThis.window
    let resizeCallback: ResizeObserverCallback | null = null
    let animationCallback: FrameRequestCallback | null = null
    const observed: Element[] = []
    const scrollListeners = new Set<EventListener>()
    const scrollCalls: Array<{ top: number; left: number }> = []

    class TestResizeObserver {
        constructor(callback: ResizeObserverCallback) { resizeCallback = callback }
        observe(target: Element) { observed.push(target) }
        unobserve() { return undefined }
        disconnect() { return undefined }
    }

    Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: TestResizeObserver })
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            requestAnimationFrame(callback: FrameRequestCallback) { animationCallback = callback; return 1 },
            cancelAnimationFrame() { animationCallback = null },
        },
    })

    const pane = {
        clientHeight: 700,
        scrollHeight: 1_600,
        scrollTop: 900,
        addEventListener(type: string, listener: EventListener) { if (type === "scroll") scrollListeners.add(listener) },
        removeEventListener(type: string, listener: EventListener) { if (type === "scroll") scrollListeners.delete(listener) },
        scrollTo({ top, left }: { top: number; left: number }) { this.scrollTop = top; scrollCalls.push({ top, left }) },
    } as unknown as HTMLDivElement
    const composer = {} as HTMLElement

    try {
        const cleanup = observeMessagePaneResize(pane, () => true, true, composer)
        assert.deepEqual(observed, [pane, composer])

        pane.clientHeight = 620
        scrollListeners.forEach((listener) => listener(new Event("scroll")))
        resizeCallback?.([], {} as ResizeObserver)
        assert.ok(animationCallback)
        animationCallback?.(0)

        assert.deepEqual(scrollCalls, [{ top: 980, left: 0 }])
        cleanup()
    } finally {
        Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: originalResizeObserver })
        Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow })
    }
})
