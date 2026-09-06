import assert from "node:assert/strict"
import test from "node:test"
import { containComposerTouch } from "../components/communications/composer-touch.ts"

function setup(draft?: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
    const listeners = new Map<string, (event: unknown) => void>()
    const surface = {
        addEventListener(name: string, fn: (event: unknown) => void, options?: { passive: boolean }) {
            if (name === "touchmove") assert.equal(options?.passive, false)
            listeners.set(name, fn)
        },
        removeEventListener(name: string) { listeners.delete(name) },
    }
    const cleanup = containComposerTouch(surface as unknown as HTMLElement)
    const emit = (name: string, y: number, count = 1) => {
        let prevented = false
        listeners.get(name)?.({ touches: Array.from({ length: count }, () => ({ clientY: y })), target: { closest: () => draft ?? null }, cancelable: true, preventDefault: () => { prevented = true } })
        return prevented
    }
    return { emit, cleanup, listeners }
}

test("empty composer and footer drags cannot pan the page; taps stay native", () => {
    for (const draft of [undefined, { scrollHeight: 44, clientHeight: 44, scrollTop: 0 }]) {
        const { emit, cleanup, listeners } = setup(draft)
        assert.equal(emit("touchstart", 100), false)
        assert.equal(emit("touchmove", 70), true)
        assert.equal(emit("touchmove", 110), true)
        cleanup()
        assert.equal(listeners.size, 0)
    }
})

test("long drafts scroll internally but block outward drags at both boundaries", () => {
    const draft = { scrollHeight: 240, clientHeight: 100, scrollTop: 50 }
    const { emit } = setup(draft)
    emit("touchstart", 100)
    assert.equal(emit("touchmove", 90), false)
    draft.scrollTop = 140
    assert.equal(emit("touchmove", 80), true)
    assert.equal(emit("touchmove", 90), false)
    draft.scrollTop = 0
    assert.equal(emit("touchmove", 100), true)
    assert.equal(emit("touchmove", 90), false)
})

test("multi-touch and cancelled gestures are left alone", () => {
    const { emit } = setup()
    emit("touchstart", 100, 2)
    assert.equal(emit("touchmove", 80, 2), false)
    emit("touchstart", 100)
    emit("touchcancel", 100, 0)
    assert.equal(emit("touchmove", 80), false)
})
