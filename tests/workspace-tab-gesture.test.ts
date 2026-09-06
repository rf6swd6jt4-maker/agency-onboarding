import assert from "node:assert/strict"
import test from "node:test"
import { beginWorkspaceTabGesture, WORKSPACE_TAB_HOLD_MS } from "../lib/workspace-tab-gesture.ts"

type GestureEvent = { pointerId: number; clientX: number; clientY: number; touches: object[]; cancelable: boolean; preventDefault: () => void }

function harness(pointerType = "touch") {
    const listeners = new Map<string, Set<(event: GestureEvent) => void>>()
    const timers = new Map<number, () => void>()
    const calls: string[] = []
    let captured = false
    const events = {
        addEventListener(name: string, fn: (event: GestureEvent) => void, options?: { passive: boolean }) {
            if (name === "touchmove") assert.equal(options?.passive, false)
            const set = listeners.get(name) ?? new Set()
            set.add(fn); listeners.set(name, set)
        },
        removeEventListener(name: string, fn: (event: GestureEvent) => void) { listeners.get(name)?.delete(fn) },
    }
    const host = { ...events,
        setTimeout(fn: () => void, delay: number) { assert.equal(delay, WORKSPACE_TAB_HOLD_MS); timers.set(1, fn); return 1 },
        clearTimeout(id: number) { timers.delete(id) },
    }
    const target = { ...events, closest() { return null }, ownerDocument: { defaultView: host },
        setPointerCapture() { captured = true },
        hasPointerCapture() { return captured },
        releasePointerCapture() { captured = false },
    }
    const abort = beginWorkspaceTabGesture(target as unknown as HTMLElement,
        { pointerId: 1, pointerType, clientX: 100, clientY: 50 }, {
            onLift: (x) => calls.push(`lift:${x}`),
            onMove: (x) => calls.push(`move:${x}`),
            onFinish: (result) => calls.push(result),
        })
    return {
        calls, abort,
        get captured() { return captured },
        get listenersRemaining() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0) },
        hold() { for (const fn of timers.values()) fn(); timers.clear() },
        emit(name: string, x = 100, y = 50, pointerId = 1) {
            let prevented = false
            for (const fn of [...(listeners.get(name) ?? [])]) fn({ pointerId, clientX: x, clientY: y, touches: [{}], cancelable: true, preventDefault() { prevented = true } })
            return prevented
        },
    }
}

test("a quick swipe stays native and permanently cancels the hold", () => {
    const h = harness()
    assert.equal(h.captured, false)
    assert.equal(h.emit("touchmove", 105), false)
    assert.equal(h.emit("pointermove", 125), false)
    h.hold()
    assert.deepEqual(h.calls, ["scroll"])
    assert.equal(h.listenersRemaining, 0)
})

test("a stationary hold lifts before movement, then contains touch scrolling", () => {
    const h = harness()
    h.emit("pointermove", 104)
    h.hold()
    assert.deepEqual(h.calls, ["lift:104"])
    assert.equal(h.captured, true)
    assert.equal(h.emit("touchmove"), true)
    h.emit("pointermove", 170)
    h.emit("pointerup", 170)
    assert.deepEqual(h.calls, ["lift:104", "move:170", "drop"])
    assert.equal(h.captured, false)
    assert.equal(h.listenersRemaining, 0)
})

test("a short tap never lifts or captures", () => {
    const h = harness()
    h.emit("pointerup")
    h.hold()
    assert.deepEqual(h.calls, ["tap"])
    assert.equal(h.captured, false)
})

test("vertical movement and pointer cancellation also cancel the hold", () => {
    for (const event of ["pointermove", "pointercancel"]) {
        const h = harness()
        h.emit(event, 100, 75)
        h.hold()
        assert.deepEqual(h.calls, [event === "pointermove" ? "scroll" : "cancel"])
        assert.equal(h.listenersRemaining, 0)
    }
})

test("desktop lifts on horizontal movement without a hold", () => {
    const h = harness("mouse")
    h.emit("pointermove", 103)
    assert.deepEqual(h.calls, [])
    h.emit("pointermove", 110)
    assert.deepEqual(h.calls, ["lift:110", "move:110"])
    h.emit("pointerup", 110)
    assert.equal(h.calls.at(-1), "drop")
})

test("lost capture, window blur, and unmount release a lifted tab exactly once", () => {
    for (const event of ["lostpointercapture", "blur", "unmount"]) {
        const h = harness()
        h.hold()
        if (event === "unmount") h.abort()
        else h.emit(event)
        h.abort()
        assert.deepEqual(h.calls, ["lift:100", "cancel"])
        assert.equal(h.captured, false)
        assert.equal(h.listenersRemaining, 0)
    }
})
