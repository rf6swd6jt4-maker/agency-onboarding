import assert from "node:assert/strict"
import test from "node:test"
import { createMessageLongPress, MESSAGE_LONG_PRESS_MS } from "../lib/communications/message-long-press.ts"

test("a stationary hold opens once, only after the threshold", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] })
    const gesture = createMessageLongPress()
    const open = t.mock.fn()
    gesture.start(30, 40, open)
    t.mock.timers.tick(MESSAGE_LONG_PRESS_MS - 1)
    assert.equal(open.mock.callCount(), 0)
    gesture.move(33, 44)
    t.mock.timers.tick(1)
    assert.equal(open.mock.callCount(), 1)
    assert.equal(gesture.triggered, true)
    t.mock.timers.tick(1000)
    assert.equal(open.mock.callCount(), 1)
})

test("a short tap, cancellation, or unmount cannot open actions later", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] })
    const gesture = createMessageLongPress()
    const open = t.mock.fn()
    gesture.start(0, 0, open)
    t.mock.timers.tick(200)
    gesture.cancel()
    t.mock.timers.tick(1000)
    assert.equal(open.mock.callCount(), 0)
    assert.equal(gesture.triggered, false)
})

test("scrolling or swiping cancels a hold even if the finger returns", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] })
    const gesture = createMessageLongPress()
    const open = t.mock.fn()
    for (const [x, y] of [[11, 0], [0, 11], [8, 8], [-11, 0]]) {
        gesture.start(0, 0, open)
        gesture.move(x, y)
        gesture.move(0, 0)
        t.mock.timers.tick(1000)
    }
    assert.equal(open.mock.callCount(), 0)
})

test("a new gesture cancels the previous timer and can open independently", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] })
    const gesture = createMessageLongPress()
    const oldOpen = t.mock.fn()
    const newOpen = t.mock.fn()
    gesture.start(0, 0, oldOpen)
    t.mock.timers.tick(300)
    gesture.start(0, 0, newOpen)
    t.mock.timers.tick(200)
    assert.equal(oldOpen.mock.callCount(), 0)
    assert.equal(newOpen.mock.callCount(), 0)
    t.mock.timers.tick(250)
    assert.equal(newOpen.mock.callCount(), 1)
})
