import assert from "node:assert/strict"
import test from "node:test"

import { keepComposerCurrentLineCentered } from "../components/communications/composer-scroll.ts"

test("measuring a grown composer never collapses the live textarea", () => {
    const originalDocument = globalThis.document
    const originalWindow = globalThis.window
    const liveHeightWrites: string[] = []
    let measurementAppended = false
    let measurementRemoved = false
    let animationCallback: FrameRequestCallback | null = null

    const measurement = {
        value: "",
        tabIndex: 0,
        scrollHeight: 92,
        style: {},
        setAttribute() { return undefined },
        remove() { measurementRemoved = true },
    }
    const liveStyle = {
        transition: "height 180ms ease",
        overflowY: "hidden",
        set height(value: string) { liveHeightWrites.push(value) },
        get height() { return liveHeightWrites.at(-1) ?? "68px" },
    }
    const textarea = {
        value: "First line\nSecond line\nThird line",
        style: liveStyle,
        parentElement: {
            appendChild(node: unknown) {
                assert.equal(node, measurement)
                measurementAppended = true
            },
        },
        cloneNode() { return measurement },
        getBoundingClientRect() { return { height: 68, width: 320 } },
        get offsetHeight() { return 68 },
        scrollHeight: 92,
        clientHeight: 68,
        scrollTop: 0,
    } as unknown as HTMLTextAreaElement

    Object.defineProperty(globalThis, "document", { configurable: true, value: { body: { appendChild() { return undefined } } } })
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            getComputedStyle() { return { lineHeight: "24px", paddingTop: "10px", paddingBottom: "10px" } },
            matchMedia() { return { matches: false } },
            requestAnimationFrame(callback: FrameRequestCallback) { animationCallback = callback; return 1 },
        },
    })

    try {
        keepComposerCurrentLineCentered(textarea)

        assert.equal(measurementAppended, true)
        assert.equal(measurementRemoved, true)
        assert.deepEqual(liveHeightWrites, ["68px", "92px"])
        assert.ok(animationCallback)
        ;(animationCallback as FrameRequestCallback)(0)
        assert.equal(textarea.scrollTop, 24)
    } finally {
        Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument })
        Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow })
    }
})
