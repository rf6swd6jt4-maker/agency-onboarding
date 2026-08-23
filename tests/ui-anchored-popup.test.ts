import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { anchoredPopupPosition } from "../components/ui/anchored-popup-position.ts"

test("anchored popups sit above their trigger and clamp to a mobile viewport", () => {
    const position = anchoredPopupPosition({
        trigger: { left: 350, right: 382, top: 700 },
        popupWidth: 208,
        popupHeight: 260,
        viewport: { left: 0, top: 0, width: 390, height: 844 },
        align: "end",
    })

    assert.equal(position.left, 174)
    assert.equal(position.top, 434)
    assert.equal(position.top + 260 + 6, 700)
    assert.equal(position.maxWidth, 374)
})

test("anchored popups stay inside the top and side safety edges", () => {
    const position = anchoredPopupPosition({
        trigger: { left: 2, right: 34, top: 58 },
        popupWidth: 420,
        popupHeight: 300,
        viewport: { left: 0, top: 20, width: 390, height: 600 },
        align: "start",
    })

    assert.equal(position.left, 8)
    assert.equal(position.top, 28)
    assert.equal(position.maxHeight, 24)
    assert.equal(position.maxWidth, 374)
})

test("field and list menus share the parent-aware anchored popup primitive", async () => {
    const [popup, listMenu, mobileSurface, fields, standards] = await Promise.all([
        readFile("components/ui/AnchoredPopup.tsx", "utf8"),
        readFile("components/list/ListActionMenu.tsx", "utf8"),
        readFile("components/list/MobileCardActionSurface.tsx", "utf8"),
        readFile("app/[workspaceSlug]/work-items/[id]/InlineWorkItemFields.tsx", "utf8"),
        readFile("docs/ui-standards.md", "utf8"),
    ])

    assert.match(popup, /createPortal/)
    assert.match(popup, /sourceWindow\.parent\.document/)
    assert.match(popup, /visualViewport/)
    assert.match(popup, /ResizeObserver/)
    assert.match(popup, /z-\[2147483646\]/)
    assert.match(listMenu, /<AnchoredPopup/)
    assert.match(mobileSurface, /<AnchoredPopup/)
    assert.match(fields, /<AnchoredPopup/)
    assert.match(standards, /open directly above/)
})
