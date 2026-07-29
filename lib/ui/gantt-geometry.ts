export function ganttDragDayDelta(pixelDelta: number, dayWidth: number) {
    if (!Number.isFinite(pixelDelta) || !Number.isFinite(dayWidth) || dayWidth <= 0) return 0
    return Math.round(pixelDelta / dayWidth)
}

export type GanttScale = "quarter_hour" | "hour" | "three_hour" | "day" | "week" | "month"

export type GanttTimingItem = {
    id: string
    status: string
    parentWorkItemId: string | null
    plannedStartDate: string | null
    plannedStartTime: string | null
    dueDate: string | null
    dueTime: string | null
    actualStartAt: string | null
    actualStartHasTime: boolean
    actualCompletedAt: string | null
    actualCompletedHasTime: boolean
    workflowRole?: string
    sortOrder?: number
}

export type GanttDisplayRange = {
    start: number
    end: number | null
    derived: boolean
    open: boolean
    futureOpen: boolean
}

export type GanttWorkflowProjection = {
    ranges: Map<string, GanttDisplayRange>
    ghostItemIds: Set<string>
    hiddenItemIds: Set<string>
    completionAnchors: Map<string, number>
}

export type GanttProjectedBarGeometry = {
    left: number
    right: number
    width: number
    truthfulRight: number
    overflow: boolean
}

const DAY_MS = 86_400_000

function minuteTime(value: string | null) {
    if (!value) return 0
    const [hours, minutes] = value.slice(0, 5).split(":").map(Number)
    return Number.isInteger(hours) && Number.isInteger(minutes) ? hours * 60 + minutes : 0
}

function dateDay(value: string) {
    return Math.floor(Date.parse(`${value.slice(0, 10)}T00:00:00Z`) / DAY_MS)
}

function localIsoDay(value: string, hasTime: boolean, end: boolean) {
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return null
    const day = Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()) / DAY_MS
    if (!hasTime) return day + (end ? 1 : 0)
    return day + (parsed.getHours() * 60 + parsed.getMinutes()) / 1440
}

function plannedDay(date: string | null, time: string | null, end: boolean) {
    if (!date) return null
    return dateDay(date) + (time ? minuteTime(time) / 1440 : end ? 1 : 0)
}

export function ganttExplicitDisplayRange(item: GanttTimingItem, nowDay: number): GanttDisplayRange | null {
    const start = item.actualStartAt
        ? localIsoDay(item.actualStartAt, item.actualStartHasTime, false)
        : plannedDay(item.plannedStartDate, item.plannedStartTime, false)
    if (start === null) return null
    const end = item.actualCompletedAt
        ? localIsoDay(item.actualCompletedAt, item.actualCompletedHasTime, true)
        : plannedDay(item.dueDate, item.dueTime, true)
    if (end !== null) return { start, end: Math.max(start, end), derived: false, open: false, futureOpen: false }
    const incomplete = !["done", "canceled"].includes(item.status)
    return {
        start,
        end: incomplete && start <= nowDay ? nowDay : null,
        derived: false,
        open: incomplete && start <= nowDay,
        futureOpen: incomplete && start > nowDay,
    }
}

export function ganttDisplayRanges(items: GanttTimingItem[], nowDay: number) {
    const byId = new Map(items.map((item) => [item.id, item]))
    const children = new Map<string, string[]>()
    for (const item of items) if (item.parentWorkItemId && byId.has(item.parentWorkItemId)) children.set(item.parentWorkItemId, [...(children.get(item.parentWorkItemId) ?? []), item.id])
    const output = new Map<string, GanttDisplayRange>()
    const resolving = new Set<string>()
    const resolve = (id: string): GanttDisplayRange | null => {
        if (output.has(id)) return output.get(id)!
        if (resolving.has(id)) return null
        const item = byId.get(id)
        if (!item) return null
        resolving.add(id)
        const explicit = ganttExplicitDisplayRange(item, nowDay)
        if (explicit) output.set(id, explicit)
        else {
            const childRanges = (children.get(id) ?? []).flatMap((childId) => {
                const range = resolve(childId)
                return range ? [range] : []
            })
            if (childRanges.length) output.set(id, {
                start: Math.min(...childRanges.map((range) => range.start)),
                end: Math.max(...childRanges.map((range) => range.end ?? range.start)),
                derived: true,
                open: false,
                futureOpen: false,
            })
        }
        resolving.delete(id)
        return output.get(id) ?? null
    }
    for (const item of items) resolve(item.id)
    return output
}

// Lifecycle automation has several backend implementations (canonical forms,
// review work, and SOP work), but the chart deliberately presents one model:
// children of a workflow stage are a sequence; direct service groups fan out.
// This is a view projection only, so it can be removed without touching the
// persisted schedules or the automation paths that create them.
export function ganttWorkflowChildProjection(
    items: GanttTimingItem[],
    dependencies: Array<{ workItemId: string; dependsOnWorkItemId: string }>,
    baseRanges: Map<string, GanttDisplayRange>,
    nowDay: number,
    scale: GanttScale,
): GanttWorkflowProjection {
    const byId = new Map(items.map((item) => [item.id, item]))
    const childrenByParent = new Map<string, GanttTimingItem[]>()
    for (const item of items) {
        if (!item.parentWorkItemId || !byId.has(item.parentWorkItemId)) continue
        childrenByParent.set(item.parentWorkItemId, [...(childrenByParent.get(item.parentWorkItemId) ?? []), item])
    }
    const ranges = new Map(baseRanges)
    const ghostItemIds = new Set<string>()
    const hiddenItemIds = new Set<string>()
    const completionAnchors = new Map<string, number>()
    const depth = (item: GanttTimingItem) => {
        let result = 0
        let parentId = item.parentWorkItemId
        const seen = new Set<string>()
        while (parentId && !seen.has(parentId)) {
            seen.add(parentId)
            result += 1
            parentId = byId.get(parentId)?.parentWorkItemId ?? null
        }
        return result
    }

    for (const parent of [...items].sort((left, right) => depth(left) - depth(right))) {
        const children = childrenByParent.get(parent.id) ?? []
        const parentRange = ranges.get(parent.id)
        if (!parentRange || !children.length) continue

        // A fulfilment stage's direct service groups genuinely start together.
        // Their internal SOP children are handled by the sequential branch below.
        if (children.every((child) => child.workflowRole === "service_group")) {
            for (const child of children) {
                const childRange = ranges.get(child.id)
                const completed = childRange && !childRange.open && childRange.end !== null && ["done", "canceled"].includes(child.status)
                if (completed && childRange?.end !== null && childRange?.end !== undefined) {
                    ranges.set(child.id, { ...childRange, start: parentRange.start, end: Math.max(parentRange.start, childRange.end), derived: false, futureOpen: false })
                } else {
                    ranges.set(child.id, { start: parentRange.start, end: parentRange.open ? nowDay : parentRange.end, derived: false, open: parentRange.open, futureOpen: false })
                }
            }
            continue
        }

        if (parent.workflowRole !== "lifecycle_stage" && parent.workflowRole !== "service_group") continue
        const ordered = ganttStableTopologicalOrder(children, dependencies, (left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0) || items.indexOf(left) - items.indexOf(right))
        let cursor = parentRange.start
        let firstIncomplete = true
        let visibleFuture = false
        // The following lifecycle stage is the next actionable stage, not a
        // forecast of every hidden onboarding/SOP step. Keep its anchor on the
        // visible next step so collapsing this parent does not push it away.
        let nextStageAnchor: number | null = null
        for (const child of ordered) {
            const childRange = ranges.get(child.id)
            const complete = ["done", "canceled"].includes(child.status)
            if (complete) {
                const end = Math.max(cursor, childRange?.end ?? cursor)
                ranges.set(child.id, { start: cursor, end, derived: false, open: false, futureOpen: false })
                cursor = end
                continue
            }
            if (firstIncomplete) {
                const end = parentRange.open ? Math.max(cursor, nowDay) : ganttAdvanceIntervals(cursor, scale, 1)
                ranges.set(child.id, { start: cursor, end, derived: false, open: parentRange.open, futureOpen: false })
                if (!parentRange.open) ghostItemIds.add(child.id)
                cursor = end
                nextStageAnchor = end
                firstIncomplete = false
                continue
            }
            const end = ganttAdvanceIntervals(cursor, scale, 1)
            if (!visibleFuture) {
                nextStageAnchor = cursor
                ranges.set(child.id, { start: cursor, end, derived: false, open: false, futureOpen: false })
                ghostItemIds.add(child.id)
                visibleFuture = true
            } else {
                ranges.delete(child.id)
                hiddenItemIds.add(child.id)
            }
            cursor = end
        }
        completionAnchors.set(parent.id, nextStageAnchor ?? Math.max(cursor, parentRange.end ?? cursor))
    }
    return { ranges, ghostItemIds, hiddenItemIds, completionAnchors }
}

export function ganttDependencyGhostRanges(
    items: GanttTimingItem[],
    dependencies: Array<{ workItemId: string; dependsOnWorkItemId: string }>,
    explicitRanges: Map<string, GanttDisplayRange>,
    nowDay: number,
    scale: GanttScale,
    completionAnchors = new Map<string, number>(),
    hiddenItemIds = new Set<string>(),
) {
    const output = new Map<string, GanttDisplayRange>()
    const byId = new Map(items.map((item) => [item.id, item]))
    for (let pass = 0; pass <= dependencies.length; pass += 1) {
        let changed = false
        for (const edge of dependencies) {
            const item = byId.get(edge.workItemId)
            // The sequential workflow projection intentionally keeps only the
            // active child and one successor. Do not recreate its hidden tail
            // as generic dependency ghosts.
            if (!item || hiddenItemIds.has(item.id) || explicitRanges.has(item.id) || output.has(item.id)) continue
            let ancestorId = item.parentWorkItemId
            let predecessorIsAncestor = false
            while (ancestorId) {
                if (ancestorId === edge.dependsOnWorkItemId) { predecessorIsAncestor = true; break }
                ancestorId = byId.get(ancestorId)?.parentWorkItemId ?? null
            }
            if (predecessorIsAncestor) continue
            const predecessor = output.get(edge.dependsOnWorkItemId) ?? explicitRanges.get(edge.dependsOnWorkItemId)
            if (!predecessor) continue
            const start = completionAnchors.get(edge.dependsOnWorkItemId) ?? (predecessor.open ? nowDay : predecessor.end ?? predecessor.start)
            output.set(item.id, { start, end: ganttAdvanceIntervals(start, scale, 1), derived: false, open: false, futureOpen: false })
            changed = true
        }
        if (!changed) break
    }
    return output
}

function scaleStepDays(scale: GanttScale) {
    if (scale === "quarter_hour") return 15 / 1440
    if (scale === "hour") return 1 / 24
    if (scale === "three_hour") return 3 / 24
    if (scale === "day") return 1
    if (scale === "week") return 7
    return null
}

function utcParts(day: number) {
    const date = new Date(Math.floor(day) * DAY_MS)
    return { year: date.getUTCFullYear(), month: date.getUTCMonth(), date: date.getUTCDate(), fraction: day - Math.floor(day) }
}

function addCalendarMonths(day: number, months: number) {
    const parts = utcParts(day)
    const date = new Date(Date.UTC(parts.year, parts.month + months, 1))
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
    date.setUTCDate(Math.min(parts.date, lastDay))
    return date.getTime() / DAY_MS + parts.fraction
}

export function ganttAdvanceIntervals(day: number, scale: GanttScale, intervals: number) {
    const step = scaleStepDays(scale)
    if (step !== null) return day + step * intervals
    const whole = Math.floor(intervals)
    const afterWhole = addCalendarMonths(day, whole)
    if (intervals === whole) return afterWhole
    const afterNext = addCalendarMonths(afterWhole, 1)
    return afterWhole + (afterNext - afterWhole) * (intervals - whole)
}

export function ganttNextGridDivider(day: number, scale: GanttScale) {
    const step = scaleStepDays(scale)
    if (step !== null && scale !== "week") return (Math.floor(day / step + 1e-8) + 1) * step
    if (scale === "week") {
        const wholeDay = Math.floor(day)
        const weekday = new Date(wholeDay * DAY_MS).getUTCDay()
        const daysToMonday = (8 - weekday) % 7 || 7
        return wholeDay + daysToMonday
    }
    const parts = utcParts(day)
    return Date.UTC(parts.year, parts.month + 1, 1) / DAY_MS
}

export function ganttPreviousGridDivider(day: number, scale: GanttScale) {
    const step = scaleStepDays(scale)
    if (step !== null && scale !== "week") return Math.floor((day + 1e-8) / step) * step
    if (scale === "week") {
        const wholeDay = Math.floor(day)
        const weekday = new Date(wholeDay * DAY_MS).getUTCDay()
        return wholeDay - ((weekday + 6) % 7)
    }
    const parts = utcParts(day)
    return Date.UTC(parts.year, parts.month, 1) / DAY_MS
}

export function ganttOpenTrailEnd(visualRightDay: number, scale: GanttScale) {
    const divider = ganttNextGridDivider(visualRightDay, scale)
    return divider + (ganttAdvanceIntervals(divider, scale, 1) - divider) / 2
}

export function ganttGridDividerAtOrAfter(day: number, scale: GanttScale, nowDay?: number) {
    const previous = ganttPreviousGridDivider(day, scale)
    const activeDivider = Math.abs(previous - day) < 1e-7 ? previous : ganttNextGridDivider(day, scale)
    if (nowDay !== undefined && nowDay >= day - 1e-7) return Math.min(activeDivider, nowDay)
    return activeDivider
}

export function ganttProjectDay(day: number, rangeStart: number, dayWidth: number, gutter = 0) {
    return gutter + (day - rangeStart) * dayWidth
}

export function ganttProjectedBarGeometry({ range, scale, rangeStart, dayWidth, gutter = 0, inset = 0, contentWidth = 0 }: {
    range: GanttDisplayRange
    scale: GanttScale
    rangeStart: number
    dayWidth: number
    gutter?: number
    inset?: number
    contentWidth?: number
}): GanttProjectedBarGeometry {
    const endDay = range.end ?? (range.futureOpen ? ganttAdvanceIntervals(range.start, scale, 1.5) : range.start)
    const projectedLeft = ganttProjectDay(range.start, rangeStart, dayWidth, gutter)
    const projectedRight = ganttProjectDay(endDay, rangeStart, dayWidth, gutter)
    const effectiveInset = Math.min(inset, Math.max(0, (projectedRight - projectedLeft - 1) / 2))
    const left = projectedLeft + effectiveInset
    // Open work reaches the now line exactly. Completed/due work retains the
    // visual clearance that keeps its edge and connector arrow off a divider.
    const truthfulRight = range.open ? projectedRight : Math.max(left + 1, projectedRight - effectiveInset)
    const right = range.open ? Math.max(truthfulRight, left + contentWidth) : truthfulRight
    return { left, right, width: Math.max(1, right - left), truthfulRight, overflow: range.open && right > truthfulRight + .5 }
}

export function ganttGridDividers(rangeStart: number, rangeDays: number, scale: GanttScale) {
    const output: number[] = []
    let divider = ganttNextGridDivider(rangeStart - 1e-6, scale)
    for (let count = 0; divider <= rangeStart + rangeDays + 1e-6 && count < 12_000; count += 1) {
        output.push(divider)
        const next = ganttNextGridDivider(divider + 1e-7, scale)
        if (next <= divider) break
        divider = next
    }
    return output
}

export function ganttStableTopologicalOrder<T extends { id: string }>(items: T[], dependencies: Array<{ workItemId: string; dependsOnWorkItemId: string }>, compare: (left: T, right: T) => number) {
    const byId = new Map(items.map((item) => [item.id, item]))
    const indegree = new Map(items.map((item) => [item.id, 0]))
    const outgoing = new Map<string, string[]>()
    for (const edge of dependencies) {
        if (!byId.has(edge.workItemId) || !byId.has(edge.dependsOnWorkItemId) || edge.workItemId === edge.dependsOnWorkItemId) continue
        indegree.set(edge.workItemId, (indegree.get(edge.workItemId) ?? 0) + 1)
        outgoing.set(edge.dependsOnWorkItemId, [...(outgoing.get(edge.dependsOnWorkItemId) ?? []), edge.workItemId])
    }
    const ready = items.filter((item) => indegree.get(item.id) === 0).sort(compare)
    const result: T[] = []
    while (ready.length) {
        const item = ready.shift()!
        result.push(item)
        for (const nextId of outgoing.get(item.id) ?? []) {
            const nextDegree = (indegree.get(nextId) ?? 1) - 1
            indegree.set(nextId, nextDegree)
            if (nextDegree === 0) {
                ready.push(byId.get(nextId)!)
                ready.sort(compare)
            }
        }
    }
    if (result.length !== items.length) {
        const placed = new Set(result.map((item) => item.id))
        result.push(...items.filter((item) => !placed.has(item.id)).sort(compare))
    }
    return result
}

export function ganttBoundaryConnectorPath({ sourceRight, sourceY, sourceDivider, rowBoundaryY, targetDivider, targetY, targetLeft }: {
    sourceRight: number
    sourceY: number
    sourceDivider: number
    rowBoundaryY: number
    targetDivider: number
    targetY: number
    targetLeft: number
}) {
    return `M ${sourceRight} ${sourceY} H ${sourceDivider} V ${rowBoundaryY} H ${targetDivider} V ${targetY} H ${targetLeft}`
}

export type GanttConnectorRail = {
    sourceDivider: number
    targetDivider: number
    mode: "grid" | "local"
}

// Keep grid-aligned routing when it is already direct. When zoom makes the
// next/previous grid dividers form a long U-turn, use one local vertical rail
// just outside the source instead. The caller can retain the old route by
// bypassing this helper, which makes the policy deliberately easy to revert.
export function ganttConnectorRail({
    sourceRight,
    targetLeft,
    sourceDivider,
    targetDivider,
    clearance = 8,
    maxGridDetour = 96,
}: {
    sourceRight: number
    targetLeft: number
    sourceDivider: number
    targetDivider: number
    clearance?: number
    maxGridDetour?: number
}): GanttConnectorRail {
    const gridLength = Math.abs(sourceDivider - sourceRight) + Math.abs(targetDivider - sourceDivider) + Math.abs(targetLeft - targetDivider)
    const directLength = Math.abs(targetLeft - sourceRight)
    const gridReverses = sourceRight <= targetLeft && (sourceDivider > targetDivider || sourceDivider > targetLeft || targetDivider < sourceRight)
    if (!gridReverses && gridLength <= directLength + maxGridDetour) return { sourceDivider, targetDivider, mode: "grid" }

    if (targetLeft > sourceRight) {
        const localRail = sourceRight + Math.min(clearance, (targetLeft - sourceRight) / 2)
        return { sourceDivider: localRail, targetDivider: localRail, mode: "local" }
    }
    return { sourceDivider: sourceRight, targetDivider: sourceRight, mode: "local" }
}

export function ganttOpenOverflowConnectorPath({ sourceX, sourceBottom, rowBoundaryY, targetDivider, targetY, targetLeft }: {
    sourceX: number
    sourceBottom: number
    rowBoundaryY: number
    targetDivider: number
    targetY: number
    targetLeft: number
}) {
    return `M ${sourceX} ${sourceBottom} V ${rowBoundaryY} H ${targetDivider} V ${targetY} H ${targetLeft}`
}

// A current lifecycle stage and its next stage often meet at now. Leave from
// the stage's bottom edge and use one uninterrupted vertical leg.
export function ganttLifecycleSuccessorPath({ sourceX, sourceY, targetY, targetLeft }: {
    sourceX: number
    sourceY: number
    targetY: number
    targetLeft: number
}) {
    return `M ${sourceX} ${sourceY} V ${targetY} H ${targetLeft}`
}

export function ganttAnchoredScrollLeft({
    timelineDay,
    dayWidth,
    leftWidth,
    localX,
    gutter = 0,
}: {
    timelineDay: number
    dayWidth: number
    leftWidth: number
    localX: number
    // Empty space padded before the first day so an edge day can still be
    // scrolled to the centre of the viewport instead of clamping short.
    gutter?: number
}) {
    return Math.max(0, leftWidth + gutter + timelineDay * dayWidth - localX)
}

export function ganttArrowHeadPath(targetBarLeft: number, targetDivider: number, y: number, arrowSize = 4, minimumLeadIn = 12) {
    const distance = targetBarLeft - targetDivider
    if (Math.abs(distance) < minimumLeadIn) return null
    const wingX = targetBarLeft - Math.sign(distance) * arrowSize
    return `M ${wingX} ${y - arrowSize} L ${targetBarLeft} ${y} L ${wingX} ${y + arrowSize}`
}
