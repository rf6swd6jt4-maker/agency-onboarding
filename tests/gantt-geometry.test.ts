import test from "node:test"
import assert from "node:assert/strict"
import {
    ganttAdvanceIntervals,
    ganttAnchoredScrollLeft,
    ganttArrowHeadPath,
    ganttBoundaryConnectorPath,
    ganttConnectorRail,
    ganttDependencyGhostRanges,
    ganttDisplayRanges,
    ganttDragDayDelta,
    ganttGridDividers,
    ganttGridDividerAtOrAfter,
    ganttLifecycleSuccessorPath,
    ganttOpenOverflowConnectorPath,
    ganttOpenTrailEnd,
    ganttProjectDay,
    ganttProjectedBarGeometry,
    ganttStableTopologicalOrder,
    ganttWorkflowChildProjection,
    type GanttScale,
    type GanttTimingItem,
} from "../lib/ui/gantt-geometry.ts"

const day = (value: string) => Date.parse(`${value}T00:00:00Z`) / 86_400_000

function timingItem(id: string, overrides: Partial<GanttTimingItem> = {}): GanttTimingItem {
    return {
        id, status: "todo", parentWorkItemId: null,
        plannedStartDate: null, plannedStartTime: null, dueDate: null, dueTime: null,
        actualStartAt: null, actualStartHasTime: false, actualCompletedAt: null, actualCompletedHasTime: false,
        ...overrides,
    }
}

test("drag distance always resolves to days regardless of the active view", () => {
    assert.equal(ganttDragDayDelta(56, 56), 1)
    assert.equal(ganttDragDayDelta(112, 56), 2)
    assert.equal(ganttDragDayDelta(48, 24), 2)
    assert.equal(ganttDragDayDelta(-72, 24), -3)
})

test("zoom anchoring keeps the same timeline day under the pointer", () => {
    const timelineDay = 42.5
    const localX = 480
    const leftWidth = 260
    const nextDayWidth = 84
    const scrollLeft = ganttAnchoredScrollLeft({ timelineDay, dayWidth: nextDayWidth, leftWidth, localX })
    assert.equal((scrollLeft + localX - leftWidth) / nextDayWidth, timelineDay)
})

test("repeated mobile zoom-out steps keep the original focal day anchored", () => {
    const timelineDay = 61.25
    const localX = 286
    const leftWidth = 152
    for (const dayWidth of [56, 42, 28, 21, 14, 7]) {
        const scrollLeft = ganttAnchoredScrollLeft({ timelineDay, dayWidth, leftWidth, localX })
        assert.equal((scrollLeft + localX - leftWidth) / dayWidth, timelineDay)
    }
})

test("a gutter lets the first day be centred instead of clamping short", () => {
    const leftWidth = 260
    const chart = 900
    const centre = leftWidth + chart / 2
    const dayWidth = 64
    // The first day (timelineDay 0) anchored to the viewport centre. Without a
    // gutter the required scroll is negative, clamps to 0, and the day lands far
    // from centre; half a chart of gutter gives it room to sit dead centre.
    const gutter = chart / 2
    const clamped = ganttAnchoredScrollLeft({ timelineDay: 0, dayWidth, leftWidth, localX: centre })
    assert.equal(clamped, 0)
    assert.notEqual((clamped + centre - leftWidth) / dayWidth, 0)
    const anchored = ganttAnchoredScrollLeft({ timelineDay: 0, dayWidth, leftWidth, localX: centre, gutter })
    assert.equal((anchored + centre - leftWidth - gutter) / dayWidth, 0)
})

test("an absolute calendar anchor survives a timeline-range change", () => {
    const calendarDay = 20_500.25
    const nextRangeStart = 20_440
    const localX = 480
    const leftWidth = 260
    const dayWidth = 64
    const scrollLeft = ganttAnchoredScrollLeft({ timelineDay: calendarDay - nextRangeStart, dayWidth, leftWidth, localX })
    assert.equal(nextRangeStart + (scrollLeft + localX - leftWidth) / dayWidth, calendarDay)
})

test("arrowheads are hidden when the target lead-in cannot contain them", () => {
    assert.equal(ganttArrowHeadPath(103, 100, 40), null)
    assert.equal(ganttArrowHeadPath(111, 100, 40), null)
    assert.equal(ganttArrowHeadPath(112, 100, 40), "M 108 36 L 112 40 L 108 44")
})

test("actual timestamps independently override planned start and finish times", () => {
    const now = day("2026-07-20")
    const ranges = ganttDisplayRanges([
        timingItem("actual-start", { plannedStartDate: "2026-07-10", dueDate: "2026-07-12", actualStartAt: "2026-07-11T09:30:00", actualStartHasTime: true }),
        timingItem("actual-finish", { plannedStartDate: "2026-07-10", dueDate: "2026-07-15", actualCompletedAt: "2026-07-12T16:45:00", actualCompletedHasTime: true }),
    ], now)
    assert.equal(ranges.get("actual-start")?.start, day("2026-07-11") + 9.5 / 24)
    assert.equal(ranges.get("actual-start")?.end, day("2026-07-13"))
    assert.equal(ranges.get("actual-finish")?.start, day("2026-07-10"))
    assert.equal(ranges.get("actual-finish")?.end, day("2026-07-12") + 16.75 / 24)
})

test("date-only starts begin their day and date-only finishes include their whole day", () => {
    const range = ganttDisplayRanges([timingItem("dated", { plannedStartDate: "2026-07-10", dueDate: "2026-07-12" })], day("2026-07-20")).get("dated")!
    assert.equal(range.start, day("2026-07-10"))
    assert.equal(range.end, day("2026-07-13"))
})

test("minute differences remain proportional at every zoom density", () => {
    const start = day("2026-07-10") + 9 / 24
    const end = start + 30 / 1440
    for (const dayWidth of [12, 64, 1_056, 3_456]) {
        assert.ok(Math.abs(ganttProjectDay(end, day("2026-07-01"), dayWidth) - ganttProjectDay(start, day("2026-07-01"), dayWidth) - dayWidth / 48) < 1e-8)
    }
})

test("open bars end truthfully at now and overflow only to fit intrinsic content", () => {
    const now = day("2026-07-10") + 12 / 24
    const range = ganttDisplayRanges([timingItem("open", { plannedStartDate: "2026-07-10", plannedStartTime: "09:00" })], now).get("open")!
    const fits = ganttProjectedBarGeometry({ range, scale: "hour", rangeStart: day("2026-07-10"), dayWidth: 240, contentWidth: 20 })
    const overflows = ganttProjectedBarGeometry({ range, scale: "hour", rangeStart: day("2026-07-10"), dayWidth: 240, contentWidth: 120 })
    assert.equal(range.open, true)
    assert.equal(fits.truthfulRight, 120)
    assert.equal(fits.overflow, false)
    assert.equal(overflows.truthfulRight, 120)
    assert.equal(overflows.right, 210)
    assert.equal(overflows.overflow, true)

    const insetOverflow = ganttProjectedBarGeometry({ range, scale: "hour", rangeStart: day("2026-07-10"), dayWidth: 240, inset: 8, contentWidth: 120 })
    assert.equal(insetOverflow.left, 98)
    assert.equal(insetOverflow.truthfulRight, 120)
    assert.equal(insetOverflow.right, 218)

    const startsNow = ganttProjectedBarGeometry({ range: { ...range, start: now }, scale: "hour", rangeStart: day("2026-07-10"), dayWidth: 240, inset: 8, contentWidth: 80 })
    assert.equal(startsNow.left, 120)
    assert.equal(startsNow.truthfulRight, 120)
})

test("bars preserve an eight pixel connector clearance inside projected boundaries", () => {
    const start = day("2026-07-10")
    const range = { start, end: start + 1, derived: false, open: false, futureOpen: false }
    const geometry = ganttProjectedBarGeometry({ range, scale: "day", rangeStart: start, dayWidth: 100, inset: 8 })
    assert.equal(geometry.left, 8)
    assert.equal(geometry.right, 92)
})

test("future start-only work occupies one and a half active intervals", () => {
    const start = day("2026-07-12")
    const range = ganttDisplayRanges([timingItem("future", { plannedStartDate: "2026-07-12" })], day("2026-07-10")).get("future")!
    for (const scale of ["quarter_hour", "hour", "three_hour", "day", "week", "month"] satisfies GanttScale[]) {
        const geometry = ganttProjectedBarGeometry({ range, scale, rangeStart: start, dayWidth: 1440 })
        assert.equal(geometry.width, (ganttAdvanceIntervals(start, scale, 1.5) - start) * 1440)
    }
})

test("dashed trails reach the next divider plus half an interval", () => {
    const start = day("2026-07-10") + 9.2 / 24
    assert.equal(ganttOpenTrailEnd(start, "hour"), day("2026-07-10") + 10.5 / 24)
    assert.equal(ganttOpenTrailEnd(day("2026-07-10") + .2, "day"), day("2026-07-11") + .5)
})

test("undated dependency ghosts use one scale interval and chains resolve recursively", () => {
    const now = day("2026-07-10") + .5
    const items = [
        timingItem("open", { plannedStartDate: "2026-07-10", status: "doing" }),
        timingItem("next"),
        timingItem("later"),
    ]
    const explicit = ganttDisplayRanges(items, now)
    const ghosts = ganttDependencyGhostRanges(items, [
        { workItemId: "next", dependsOnWorkItemId: "open" },
        { workItemId: "later", dependsOnWorkItemId: "next" },
    ], explicit, now, "hour")
    assert.equal(ghosts.get("next")?.start, now)
    assert.equal(ghosts.get("next")?.end, now + 1 / 24)
    assert.equal(ghosts.get("later")?.start, now + 1 / 24)
    assert.ok(Math.abs(ghosts.get("later")!.end! - (now + 2 / 24)) < 1e-10)
})

test("parallel undated siblings share a predecessor anchor", () => {
    const now = day("2026-07-10")
    const items = [timingItem("parent", { plannedStartDate: "2026-07-08", dueDate: "2026-07-09" }), timingItem("a"), timingItem("b")]
    const explicit = ganttDisplayRanges(items, now)
    const ghosts = ganttDependencyGhostRanges(items, [{ workItemId: "a", dependsOnWorkItemId: "parent" }, { workItemId: "b", dependsOnWorkItemId: "parent" }], explicit, now, "day")
    assert.equal(ghosts.get("a")?.start, ghosts.get("b")?.start)
})

test("workflow children form a time-accurate staircase with only the next inactive step visible", () => {
    const start = day("2026-07-10") + 9 / 24
    const now = day("2026-07-10") + 12 / 24
    const items = [
        timingItem("onboarding", { status: "doing", workflowRole: "lifecycle_stage", actualStartAt: "2026-07-10T09:00:00", actualStartHasTime: true }),
        timingItem("welcome", { status: "done", parentWorkItemId: "onboarding", workflowRole: "task", sortOrder: 0, actualStartAt: "2026-07-10T09:00:00", actualStartHasTime: true, actualCompletedAt: "2026-07-10T10:30:00", actualCompletedHasTime: true }),
        timingItem("access", { parentWorkItemId: "onboarding", workflowRole: "task", sortOrder: 10 }),
        timingItem("details", { parentWorkItemId: "onboarding", workflowRole: "task", sortOrder: 20 }),
        timingItem("later", { parentWorkItemId: "onboarding", workflowRole: "task", sortOrder: 30 }),
    ]
    const base = ganttDisplayRanges(items, now)
    const projection = ganttWorkflowChildProjection(items, [
        { workItemId: "access", dependsOnWorkItemId: "welcome" },
        { workItemId: "details", dependsOnWorkItemId: "access" },
        { workItemId: "later", dependsOnWorkItemId: "details" },
    ], base, now, "hour")
    assert.equal(projection.ranges.get("welcome")?.start, start)
    assert.equal(projection.ranges.get("welcome")?.end, day("2026-07-10") + 10.5 / 24)
    assert.equal(projection.ranges.get("access")?.start, day("2026-07-10") + 10.5 / 24)
    assert.equal(projection.ranges.get("access")?.end, now)
    assert.equal(projection.ranges.get("access")?.open, true)
    assert.equal(projection.ranges.get("details")?.start, now)
    assert.equal(projection.ranges.get("details")?.end, now + 1 / 24)
    assert.equal(projection.ghostItemIds.has("details"), true)
    assert.equal(projection.hiddenItemIds.has("later"), true)
    const dependencyGhosts = ganttDependencyGhostRanges(items, [
        { workItemId: "access", dependsOnWorkItemId: "welcome" },
        { workItemId: "details", dependsOnWorkItemId: "access" },
        { workItemId: "later", dependsOnWorkItemId: "details" },
    ], projection.ranges, now, "hour", projection.completionAnchors, projection.hiddenItemIds)
    assert.equal(dependencyGhosts.has("later"), false)
    assert.equal(projection.completionAnchors.get("onboarding"), projection.ranges.get("details")?.start)
    assert.equal(projection.completionAnchors.get("onboarding"), now)
})

test("direct fulfilment service groups fan out from the parent while their SOPs remain sequential", () => {
    const start = day("2026-07-10") + 9 / 24
    const now = day("2026-07-10") + 12 / 24
    const items = [
        timingItem("fulfilment", { status: "doing", workflowRole: "lifecycle_stage", actualStartAt: "2026-07-10T09:00:00", actualStartHasTime: true }),
        timingItem("design", { parentWorkItemId: "fulfilment", workflowRole: "service_group", plannedStartDate: "2026-07-12" }),
        timingItem("seo", { parentWorkItemId: "fulfilment", workflowRole: "service_group", plannedStartDate: "2026-07-13" }),
        timingItem("draft", { parentWorkItemId: "design", workflowRole: "task", sortOrder: 0 }),
        timingItem("approve", { parentWorkItemId: "design", workflowRole: "task", sortOrder: 10 }),
    ]
    const projection = ganttWorkflowChildProjection(items, [{ workItemId: "approve", dependsOnWorkItemId: "draft" }], ganttDisplayRanges(items, now), now, "hour")
    for (const id of ["design", "seo"]) {
        assert.equal(projection.ranges.get(id)?.start, start)
        assert.equal(projection.ranges.get(id)?.end, now)
        assert.equal(projection.ranges.get(id)?.open, true)
    }
    assert.equal(projection.ranges.get("draft")?.start, start)
    assert.equal(projection.ranges.get("draft")?.end, now)
    assert.equal(projection.ranges.get("approve")?.start, now)
    assert.equal(projection.ghostItemIds.has("approve"), true)
})

test("lifecycle successor ghosts begin after the projected child sequence", () => {
    const now = day("2026-07-10") + .5
    const items = [timingItem("stage", { status: "doing", workflowRole: "lifecycle_stage", plannedStartDate: "2026-07-10" }), timingItem("next", { workflowRole: "lifecycle_stage" })]
    const base = ganttDisplayRanges(items, now)
    const anchored = ganttDependencyGhostRanges(items, [{ workItemId: "next", dependsOnWorkItemId: "stage" }], base, now, "hour", new Map([["stage", now + 3 / 24]]))
    assert.equal(anchored.get("next")?.start, now + 3 / 24)
})

test("topological ordering keeps predecessors first while retaining stable sibling order", () => {
    const items = [{ id: "parallel-b", order: 2 }, { id: "next", order: 0 }, { id: "parallel-a", order: 1 }, { id: "first", order: 3 }]
    const ordered = ganttStableTopologicalOrder(items, [{ workItemId: "next", dependsOnWorkItemId: "first" }], (a, b) => a.order - b.order)
    assert.deepEqual(ordered.map((item) => item.id), ["parallel-a", "parallel-b", "first", "next"])
})

test("standard connectors bend only at supplied dividers and row tracks", () => {
    assert.equal(ganttBoundaryConnectorPath({ sourceRight: 110, sourceY: 20, sourceDivider: 120, rowBoundaryY: 32, targetDivider: 160, targetY: 48, targetLeft: 170 }), "M 110 20 H 120 V 32 H 160 V 48 H 170")
    assert.equal(ganttOpenOverflowConnectorPath({ sourceX: 112, sourceBottom: 28, rowBoundaryY: 32, targetDivider: 100, targetY: 48, targetLeft: 170 }), "M 112 28 V 32 H 100 V 48 H 170")
    assert.equal(ganttLifecycleSuccessorPath({ sourceX: 112, sourceY: 28, targetY: 48, targetLeft: 170 }), "M 112 28 V 48 H 170")
})

test("adaptive connector rails keep a direct grid route but reject a wide grid U-turn", () => {
    assert.deepEqual(ganttConnectorRail({ sourceRight: 110, targetLeft: 170, sourceDivider: 120, targetDivider: 160 }), { sourceDivider: 120, targetDivider: 160, mode: "grid" })
    assert.deepEqual(ganttConnectorRail({ sourceRight: 320, targetLeft: 360, sourceDivider: 640, targetDivider: 272 }), { sourceDivider: 328, targetDivider: 328, mode: "local" })
    assert.deepEqual(ganttConnectorRail({ sourceRight: 420, targetLeft: 380, sourceDivider: 640, targetDivider: 272 }), { sourceDivider: 420, targetDivider: 420, mode: "local" })
})

test("connector source routing uses an exact divider or the nearer now line", () => {
    const start = day("2026-07-10")
    assert.equal(ganttGridDividerAtOrAfter(start, "day", start + .4), start)
    assert.equal(ganttGridDividerAtOrAfter(start + .25, "day", start + .4), start + .4)
    assert.equal(ganttGridDividerAtOrAfter(start + .25, "day", start + 2), start + 1)
})

test("visible divider generation follows the active scale", () => {
    const start = day("2026-07-06")
    assert.deepEqual(ganttGridDividers(start, 2, "day"), [start, start + 1, start + 2])
    assert.deepEqual(ganttGridDividers(start, 14, "week"), [start, start + 7, start + 14])
})
