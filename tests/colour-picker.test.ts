import assert from "node:assert/strict"
import test from "node:test"
import { hexToHsv, hsvToHex } from "../lib/ui/colour-picker.ts"

test("colour picker converts primary hues to stable hex values", () => {
    assert.equal(hsvToHex({ h: 0, s: 1, v: 1 }), "#FF0000")
    assert.equal(hsvToHex({ h: 120, s: 1, v: 1 }), "#00FF00")
    assert.equal(hsvToHex({ h: 240, s: 1, v: 1 }), "#0000FF")
})

test("colour picker retains saturation and brightness through a round trip", () => {
    const hsv = hexToHsv("#64748B")
    assert.equal(hsvToHex(hsv), "#64748B")
})
