import assert from "node:assert/strict"
import test from "node:test"

import { anchoredMessagePaneScrollTop } from "../components/communications/message-pane-scroll.ts"

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
