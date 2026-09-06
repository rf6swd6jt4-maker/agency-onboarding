import assert from "node:assert/strict"
import test from "node:test"
import { beginMessageSwipe, moveMessageSwipe, finishMessageSwipe } from "../lib/communications/message-swipe.ts"

const touch = (x: number, y = 0, identifier = 1) => ({ clientX: x, clientY: y, identifier })
const start = () => beginMessageSwipe("message-1", touch(200, 100))

test("left and right swipes have the same distance threshold", () => {
    for (const [direction, action] of [[-1, "delete"], [1, "reply"]] as const) {
        assert.equal(finishMessageSwipe(start(), touch(200 + direction * 52, 100), true, true), null)
        assert.equal(finishMessageSwipe(start(), touch(200 + direction * 53, 100), true, true), action)
    }
})

test("an armed left swipe survives vertical drift at release", () => {
    let swipe = moveMessageSwipe(start(), touch(175, 103), true, true)
    swipe = moveMessageSwipe(swipe, touch(140, 115), true, true)
    assert.equal(swipe.action, "delete")
    // Previously verticalAtMin became 60 and the qualifying swipe was lost.
    assert.equal(finishMessageSwipe(swipe, touch(130, 160), true, true), "delete")
})

test("an armed swipe survives a small rebound before release", () => {
    const swipe = moveMessageSwipe(start(), touch(135, 110), true, true)
    assert.equal(finishMessageSwipe(swipe, touch(185, 145), true, true), "delete")
})

test("vertical scrolling never turns into deletion or reply", () => {
    let swipe = moveMessageSwipe(start(), touch(197, 120), true, true)
    swipe = moveMessageSwipe(swipe, touch(120, 170), true, true)
    assert.equal(swipe.offset, 0)
    assert.equal(finishMessageSwipe(swipe, touch(100, 175), true, true), null)
})

test("short and diagonal movements do not arm an action", () => {
    assert.equal(finishMessageSwipe(start(), touch(180, 102), true, true), null)
    assert.equal(finishMessageSwipe(start(), touch(140, 155), true, true), null)
})

test("the release point alone can finish a quick swipe with no intermediate move event", () => {
    assert.equal(finishMessageSwipe(start(), touch(120, 110), true, true), "delete")
})

test("cancellation, missing release, and another finger cannot complete a gesture", () => {
    const swipe = moveMessageSwipe(start(), touch(130, 100), true, true)
    assert.equal(finishMessageSwipe(null, touch(130, 100), true, true), null)
    assert.equal(finishMessageSwipe(swipe, undefined, true, true), null)
    assert.equal(finishMessageSwipe(swipe, touch(130, 100, 2), true, true), null)
})

test("read-only and deletion-ineligible messages cannot trigger destructive actions", () => {
    const swipe = moveMessageSwipe(start(), touch(130, 100), true, true)
    assert.equal(finishMessageSwipe(swipe, touch(130, 100), true, false), null)
    assert.equal(finishMessageSwipe(start(), touch(130, 100), false, false), null)
    assert.equal(moveMessageSwipe(start(), touch(130, 100), true, false).offset, 0)
})

test("the first deliberately armed action owns the gesture", () => {
    const swipe = moveMessageSwipe(start(), touch(130, 100), true, true)
    assert.equal(finishMessageSwipe(swipe, touch(280, 100), true, true), "delete")
})
