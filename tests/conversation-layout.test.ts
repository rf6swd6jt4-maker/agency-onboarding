import assert from "node:assert/strict"
import test from "node:test"
import { observeConversationLayout } from "../components/communications/message-pane-observer.ts"

function fixture(following = true) {
    let resize!: () => void
    const observed: unknown[] = []
    const originalObserver = globalThis.ResizeObserver
    globalThis.ResizeObserver = class {
        constructor(callback: () => void) { resize = callback }
        observe(element: unknown) { observed.push(element) }
        disconnect() {}
    } as unknown as typeof ResizeObserver
    const listeners = new Map<string, () => void>()
    const follow = { current: following }
    const content = {}
    const state = { clientHeight: 300, scrollHeight: 1000, scrollTop: following ? 0 : 200, scrollLeft: 0 }
    const positions = Array.from({ length: 10 }, (_, i) => i * 100)
    const rows = positions.map((_, i) => ({ isConnected: true, getBoundingClientRect: () => ({ top: positions[i] - state.scrollTop, bottom: positions[i] + 100 - state.scrollTop }) }))
    const pane = {
        ...state,
        dataset: {},
        firstElementChild: content,
        get clientHeight() { return state.clientHeight }, get scrollHeight() { return state.scrollHeight },
        get scrollTop() { return state.scrollTop }, get scrollLeft() { return state.scrollLeft },
        contains: (element: unknown) => rows.includes(element as typeof rows[number]),
        getBoundingClientRect: () => ({ top: 0 }),
        querySelectorAll: () => rows,
        addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
        removeEventListener: (name: string) => listeners.delete(name),
        scrollTo: ({ top }: { top: number }) => { state.scrollTop = top },
    }
    const statuses: boolean[] = []
    const dispose = observeConversationLayout(pane as unknown as HTMLDivElement, follow, (latest) => statuses.push(latest))
    return { state, positions, follow, resize: () => resize(), scroll: () => listeners.get("scroll")?.(), observed, content, statuses, cleanup: () => { dispose(); globalThis.ResizeObserver = originalObserver } }
}

test("opening and subsequent content growth stay at latest even when the pane does not resize", () => {
    const f = fixture()
    try {
        assert.equal(f.state.scrollTop, 700)
        assert.ok(f.observed.includes(f.content))
        f.state.scrollHeight += 450
        f.resize()
        assert.equal(f.state.scrollTop, 1150)
        assert.equal(f.statuses.at(-1), true)
    } finally { f.cleanup() }
})

test("loading or removing content above a reader preserves the visible message", () => {
    const f = fixture(false)
    try {
        for (let i = 2; i < f.positions.length; i++) f.positions[i] += 250
        f.state.scrollHeight += 250
        f.resize()
        assert.equal(f.state.scrollTop, 450)
        f.state.scrollHeight += 100 // growth below the anchor must not move it
        f.resize()
        assert.equal(f.state.scrollTop, 450)
        for (let i = 2; i < f.positions.length; i++) f.positions[i] -= 250
        f.state.scrollHeight -= 250
        f.resize()
        assert.equal(f.state.scrollTop, 200)
    } finally { f.cleanup() }
})

test("hidden tabs do not overwrite the history anchor and keyboard resizing preserves the visible bottom", () => {
    const f = fixture(false)
    try {
        f.state.clientHeight = 0
        f.state.scrollTop = 0 // display:none can clamp the browser scroll position
        f.resize()
        f.state.clientHeight = 300
        f.resize()
        assert.equal(f.state.scrollTop, 200)
        f.state.clientHeight = 200
        f.resize()
        assert.equal(f.state.scrollTop, 300)
        f.state.clientHeight = 300
        f.resize()
        assert.equal(f.state.scrollTop, 200)
    } finally { f.cleanup() }
})

test("user scrolling releases latest before subsequent media resize", async () => {
    const f = fixture()
    try {
        f.state.scrollTop = 200
        f.scroll()
        f.follow.current = false // React's event handler runs after the native listener.
        await Promise.resolve()
        f.state.scrollHeight += 400
        f.resize()
        assert.equal(f.state.scrollTop, 200)
        assert.equal(f.statuses.at(-1), false)
    } finally { f.cleanup() }
})
