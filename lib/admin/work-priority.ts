export type AdminQueueWorkStatus = "todo" | "doing" | "waiting" | "blocked" | "done" | "canceled"
export type AdminQueueWorkKind = "standard" | "okr_action" | "maintenance"
export type AdminQueueDurationSource = "assignee_history" | "learned" | "admin_history" | "default"

export type AdminQueueWorkInput = {
    id: string
    title: string
    status: AdminQueueWorkStatus
    priority: number
    priority_override: number | null
    execution_owner_id: string | null
    kind: AdminQueueWorkKind
    severity: string | null
    planned_start_date: string | null
    due_date: string | null
    due_time: string | null
    actual_start_at: string | null
    actual_completed_at: string | null
    created_at: string
    updated_at: string
}

export type AdminQueueDependencyInput = {
    work_item_id: string
    depends_on_work_item_id: string
    depends_on_completed?: boolean
}

export type AdminQueueOkrInput = {
    id: string
    objective: string
    status: "draft" | "active" | "completed" | "cancelled"
    period_start: string
    period_end: string
    key_results: Array<{
        id: string
        name: string
        comparator: "at_least" | "at_most"
        baseline_value: number
        target_value: number
        current_value: number
        progress: number
        unit: "number" | "percentage" | "currency" | "duration"
        currency_code: string | null
    }>
}

export type AdminQueueOkrLinkInput = {
    work_item_id: string
    key_result_id: string
    expected_movement: number | null
    impact_hypothesis: string | null
}

export type AdminQueueContribution = {
    key_result_id: string
    key_result_name: string
    objective: string
    expected_movement: number | null
    impact_hypothesis: string | null
    unit: "number" | "percentage" | "currency" | "duration"
    currency_code: string | null
    remaining_gap: number
    remaining_gap_share: number
    attention: number
    normalized_contribution: number
    priority_value: number
}

export type AdminQueueResult = {
    work_item_id: string
    queue_position: number | null
    queue_reason: "forced" | "continuation" | "impact" | "enables" | "obligation" | "backlog" | "blocked" | "waiting" | "unassigned" | "future" | "completed"
    queue_label: string
    predicted_duration_hours: number
    conservative_duration_hours: number
    duration_source: AdminQueueDurationSource
    direct_priority_value: number
    direct_impact_rate: number
    queue_impact_rate: number
    latest_safe_start: string | null
    projected_start: string | null
    projected_finish: string | null
    projected_lateness_hours: number
    enables_work_item_id: string | null
    enables_work_item_title: string | null
    blocked_by_ids: string[]
    contributions: AdminQueueContribution[]
}

function schedulingPriority(item: AdminQueueWorkInput) {
    return item.priority_override ?? item.priority
}

const WORKDAY_START_UTC = 9
const WORKDAY_END_UTC = 17
const DEFAULT_DURATION_HOURS = 4
const DEFAULT_CONSERVATIVE_DURATION_HOURS = 6
const SHRINKAGE_SAMPLE_SIZE = 5
const MAX_DURATION_HOURS = 80
const MIN_DURATION_HOURS = 0.25

function finiteNumber(value: unknown, fallback = 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
}

function clamp(value: number, minimum: number, maximum: number) {
    return Math.max(minimum, Math.min(maximum, value))
}

function isWorkday(date: Date) {
    const day = date.getUTCDay()
    return day !== 0 && day !== 6
}

function utcDayStart(date: Date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function workdayStart(date: Date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), WORKDAY_START_UTC))
}

function workdayEnd(date: Date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), WORKDAY_END_UTC))
}

function addUtcDays(date: Date, days: number) {
    return new Date(date.getTime() + days * 86_400_000)
}

function nextWorkday(date: Date) {
    let candidate = addUtcDays(utcDayStart(date), 1)
    while (!isWorkday(candidate)) candidate = addUtcDays(candidate, 1)
    return candidate
}

function previousWorkday(date: Date) {
    let candidate = addUtcDays(utcDayStart(date), -1)
    while (!isWorkday(candidate)) candidate = addUtcDays(candidate, -1)
    return candidate
}

function normalizeForward(date: Date) {
    const candidate = new Date(date)
    if (!isWorkday(candidate)) return workdayStart(nextWorkday(candidate))
    if (candidate < workdayStart(candidate)) return workdayStart(candidate)
    if (candidate >= workdayEnd(candidate)) return workdayStart(nextWorkday(candidate))
    return candidate
}

function normalizeBackward(date: Date) {
    const candidate = new Date(date)
    if (!isWorkday(candidate)) return workdayEnd(previousWorkday(candidate))
    if (candidate > workdayEnd(candidate)) return workdayEnd(candidate)
    if (candidate <= workdayStart(candidate)) return workdayEnd(previousWorkday(candidate))
    return candidate
}

export function workingHoursBetween(startValue: Date | string, endValue: Date | string) {
    const start = new Date(startValue)
    const end = new Date(endValue)
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return 0
    let cursor = utcDayStart(start)
    const lastDay = utcDayStart(end)
    let milliseconds = 0
    let safety = 0
    while (cursor <= lastDay && safety < 4_000) {
        if (isWorkday(cursor)) {
            const lower = Math.max(start.getTime(), workdayStart(cursor).getTime())
            const upper = Math.min(end.getTime(), workdayEnd(cursor).getTime())
            if (upper > lower) milliseconds += upper - lower
        }
        cursor = addUtcDays(cursor, 1)
        safety += 1
    }
    return milliseconds / 3_600_000
}

export function addWorkingHours(startValue: Date | string, hours: number) {
    let cursor = normalizeForward(new Date(startValue))
    let remaining = Math.max(0, hours)
    let safety = 0
    while (remaining > 0 && safety < 4_000) {
        const available = (workdayEnd(cursor).getTime() - cursor.getTime()) / 3_600_000
        if (remaining <= available) return new Date(cursor.getTime() + remaining * 3_600_000)
        remaining -= available
        cursor = workdayStart(nextWorkday(cursor))
        safety += 1
    }
    return cursor
}

export function subtractWorkingHours(endValue: Date | string, hours: number) {
    let cursor = normalizeBackward(new Date(endValue))
    let remaining = Math.max(0, hours)
    let safety = 0
    while (remaining > 0 && safety < 4_000) {
        const available = (cursor.getTime() - workdayStart(cursor).getTime()) / 3_600_000
        if (remaining <= available) return new Date(cursor.getTime() - remaining * 3_600_000)
        remaining -= available
        cursor = workdayEnd(previousWorkday(cursor))
        safety += 1
    }
    return cursor
}

function percentile(values: number[], point: number) {
    if (!values.length) return 0
    const sorted = [...values].sort((left, right) => left - right)
    const position = clamp(point, 0, 1) * (sorted.length - 1)
    const lower = Math.floor(position)
    const upper = Math.ceil(position)
    if (lower === upper) return sorted[lower]
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

function geometricBlend(cohortValue: number, globalValue: number, sampleCount: number) {
    if (!sampleCount || !cohortValue) return globalValue
    const safeGlobal = globalValue || cohortValue
    return Math.exp((sampleCount * Math.log(cohortValue) + SHRINKAGE_SAMPLE_SIZE * Math.log(safeGlobal)) / (sampleCount + SHRINKAGE_SAMPLE_SIZE))
}

function predictedDurations(items: AdminQueueWorkInput[], now: Date) {
    const completed = items.flatMap((item) => {
        if (item.status !== "done" || !item.actual_start_at || !item.actual_completed_at) return []
        const duration = workingHoursBetween(item.actual_start_at, item.actual_completed_at)
        if (duration <= 0) return []
        return [{ kind: item.kind, ownerId: item.execution_owner_id, duration: clamp(duration, MIN_DURATION_HOURS, MAX_DURATION_HOURS) }]
    })
    const allDurations = completed.map((item) => item.duration)
    const globalMedian = percentile(allDurations, 0.5) || DEFAULT_DURATION_HOURS
    const globalConservative = Math.max(globalMedian, percentile(allDurations, 0.8) || DEFAULT_CONSERVATIVE_DURATION_HOURS)
    const byKind = new Map<AdminQueueWorkKind, number[]>()
    const byOwner = new Map<string, number[]>()
    const byOwnerKind = new Map<string, number[]>()
    for (const item of completed) {
        byKind.set(item.kind, [...(byKind.get(item.kind) ?? []), item.duration])
        if (item.ownerId) {
            byOwner.set(item.ownerId, [...(byOwner.get(item.ownerId) ?? []), item.duration])
            const ownerKind = `${item.ownerId}:${item.kind}`
            byOwnerKind.set(ownerKind, [...(byOwnerKind.get(ownerKind) ?? []), item.duration])
        }
    }

    return new Map(items.map((item) => {
        const kindCohort = byKind.get(item.kind) ?? []
        const kindMedian = geometricBlend(percentile(kindCohort, 0.5), globalMedian, kindCohort.length)
        const kindConservative = geometricBlend(percentile(kindCohort, 0.8), globalConservative, kindCohort.length)
        const ownerCohort = item.execution_owner_id ? byOwner.get(item.execution_owner_id) ?? [] : []
        const ownerMedian = geometricBlend(percentile(ownerCohort, 0.5), kindMedian, ownerCohort.length)
        const ownerConservative = geometricBlend(percentile(ownerCohort, 0.8), kindConservative, ownerCohort.length)
        const ownerKindCohort = item.execution_owner_id ? byOwnerKind.get(`${item.execution_owner_id}:${item.kind}`) ?? [] : []
        const predictedTotal = clamp(geometricBlend(percentile(ownerKindCohort, 0.5), ownerMedian, ownerKindCohort.length), MIN_DURATION_HOURS, MAX_DURATION_HOURS)
        const conservativeTotal = clamp(Math.max(predictedTotal, geometricBlend(percentile(ownerKindCohort, 0.8), ownerConservative, ownerKindCohort.length)), MIN_DURATION_HOURS, MAX_DURATION_HOURS)
        const elapsed = item.status === "doing" && item.actual_start_at ? workingHoursBetween(item.actual_start_at, now) : 0
        const source: AdminQueueDurationSource = ownerKindCohort.length >= 3 || ownerCohort.length >= 3 ? "assignee_history" : kindCohort.length >= 3 ? "learned" : allDurations.length ? "admin_history" : "default"
        return [item.id, {
            predicted: clamp(predictedTotal - elapsed, MIN_DURATION_HOURS, MAX_DURATION_HOURS),
            conservative: clamp(conservativeTotal - elapsed, MIN_DURATION_HOURS, MAX_DURATION_HOURS),
            source,
        }]
    }))
}

function directionAwareGap(comparator: "at_least" | "at_most", current: number, target: number) {
    return comparator === "at_most" ? Math.max(0, current - target) : Math.max(0, target - current)
}

export function okrAttention({ progress, periodStart, periodEnd, now }: { progress: number; periodStart: string; periodEnd: string; now: Date | string }) {
    const remaining = clamp(1 - finiteNumber(progress) / 100, 0, 1)
    if (remaining === 0) return 0
    const start = new Date(`${periodStart}T09:00:00.000Z`)
    const end = new Date(`${periodEnd}T17:00:00.000Z`)
    const current = new Date(now)
    if (current >= end) return Number.POSITIVE_INFINITY
    if (current <= start) return remaining
    const total = workingHoursBetween(start, end)
    const timeRemaining = total > 0 ? workingHoursBetween(current, end) / total : 0
    return timeRemaining > 0 ? remaining / timeRemaining : Number.POSITIVE_INFINITY
}

function priorityHorizon(item: AdminQueueWorkInput, calendarNow: Date, schedulingNow: Date, conservativeDuration: number) {
    const horizons: Date[] = []
    const priority = schedulingPriority(item)
    const forcedNow = priority === 1 || item.kind === "maintenance" && item.severity === "critical"
    if (forcedNow) horizons.push(addWorkingHours(schedulingNow, conservativeDuration))
    if (priority === 2) horizons.push(workdayEnd(nextWorkday(calendarNow)))
    if (priority === 3) {
        let endOfWeek = utcDayStart(calendarNow)
        const daysUntilFriday = (5 - endOfWeek.getUTCDay() + 7) % 7
        endOfWeek = addUtcDays(endOfWeek, daysUntilFriday)
        horizons.push(workdayEnd(endOfWeek))
    }
    if (item.due_date) {
        const time = item.due_time && /^\d{2}:\d{2}/.test(item.due_time) ? item.due_time.slice(0, 5) : "17:00"
        const due = new Date(`${item.due_date}T${time}:00.000Z`)
        if (Number.isFinite(due.getTime())) horizons.push(due)
    }
    if (!horizons.length) return null
    return new Date(Math.min(...horizons.map((date) => date.getTime())))
}

function futureStart(item: AdminQueueWorkInput, cursor: Date) {
    if (!item.planned_start_date) return false
    const start = new Date(`${item.planned_start_date}T09:00:00.000Z`)
    return start > cursor
}

function compareFiniteDates(left: Date | null, right: Date | null) {
    return (left?.getTime() ?? Number.POSITIVE_INFINITY) - (right?.getTime() ?? Number.POSITIVE_INFINITY)
}

export function buildAdminWorkQueue({
    items,
    dependencies,
    okrs,
    links,
    now: nowValue,
}: {
    items: AdminQueueWorkInput[]
    dependencies: AdminQueueDependencyInput[]
    okrs: AdminQueueOkrInput[]
    links: AdminQueueOkrLinkInput[]
    now: Date | string
}): AdminQueueResult[] {
    const calendarNow = new Date(nowValue)
    const now = normalizeForward(calendarNow)
    const itemById = new Map(items.map((item) => [item.id, item]))
    const durations = predictedDurations(items, now)
    const openItems = items.filter((item) => item.status !== "done" && item.status !== "canceled")
    const openIds = new Set(openItems.map((item) => item.id))
    const completedIds = new Set([
        ...items.filter((item) => item.status === "done").map((item) => item.id),
        ...dependencies.filter((dependency) => dependency.depends_on_completed).map((dependency) => dependency.depends_on_work_item_id),
    ])

    const activeOkrs = okrs.filter((okr) => okr.status === "active" && okr.key_results.some((result) => directionAwareGap(result.comparator, result.current_value, result.target_value) > 0))
    const keyResultContext = new Map<string, {
        okr: AdminQueueOkrInput
        result: AdminQueueOkrInput["key_results"][number]
        weight: number
        attention: number
    }>()
    const objectiveWeight = activeOkrs.length ? 1 / activeOkrs.length : 0
    for (const okr of activeOkrs) {
        const incompleteResults = okr.key_results.filter((result) => directionAwareGap(result.comparator, result.current_value, result.target_value) > 0)
        const keyResultWeight = objectiveWeight / incompleteResults.length
        for (const result of okr.key_results) keyResultContext.set(result.id, {
            okr,
            result,
            weight: incompleteResults.some((candidate) => candidate.id === result.id) ? keyResultWeight : 0,
            attention: okrAttention({ progress: result.progress, periodStart: okr.period_start, periodEnd: okr.period_end, now: calendarNow }),
        })
    }

    const contributionsByItem = new Map<string, AdminQueueContribution[]>()
    const contributionModelsByItem = new Map<string, Array<{ keyResultId: string; expectedMovement: number; span: number; weight: number; pressure: number }>>()
    const initialGapByKeyResult = new Map<string, number>()
    for (const [keyResultId, context] of keyResultContext) initialGapByKeyResult.set(keyResultId, directionAwareGap(context.result.comparator, context.result.current_value, context.result.target_value))
    for (const link of links) {
        const context = keyResultContext.get(link.key_result_id)
        if (!context) continue
        const { okr, result, weight, attention } = context
        const span = Math.abs(result.target_value - result.baseline_value)
        const gap = directionAwareGap(result.comparator, result.current_value, result.target_value)
        const expectedMovement = link.expected_movement === null ? null : finiteNumber(link.expected_movement)
        const normalized = span > 0 && expectedMovement !== null && expectedMovement > 0 ? Math.min(expectedMovement, gap) / span : 0
        const pressure = clamp(Number.isFinite(attention) ? attention : 3, 0.25, 3)
        const contribution: AdminQueueContribution = {
            key_result_id: result.id,
            key_result_name: result.name,
            objective: okr.objective,
            expected_movement: expectedMovement,
            impact_hypothesis: link.impact_hypothesis,
            unit: result.unit,
            currency_code: result.currency_code,
            remaining_gap: gap,
            remaining_gap_share: gap > 0 && expectedMovement !== null ? clamp(expectedMovement / gap, 0, 1) : 0,
            attention,
            normalized_contribution: normalized,
            priority_value: weight * normalized * pressure * 100,
        }
        contributionsByItem.set(link.work_item_id, [...(contributionsByItem.get(link.work_item_id) ?? []), contribution])
        if (expectedMovement !== null && expectedMovement > 0 && span > 0 && weight > 0) contributionModelsByItem.set(link.work_item_id, [
            ...(contributionModelsByItem.get(link.work_item_id) ?? []),
            { keyResultId: result.id, expectedMovement, span, weight, pressure },
        ])
    }

    const directValue = new Map(openItems.map((item) => [item.id, (contributionsByItem.get(item.id) ?? []).reduce((total, contribution) => total + contribution.priority_value, 0)]))
    const directRate = new Map(openItems.map((item) => [item.id, (directValue.get(item.id) ?? 0) / (durations.get(item.id)?.predicted ?? DEFAULT_DURATION_HOURS)]))

    const prerequisitesByItem = new Map<string, string[]>()
    const dependentsByItem = new Map<string, string[]>()
    for (const dependency of dependencies) {
        prerequisitesByItem.set(dependency.work_item_id, [...(prerequisitesByItem.get(dependency.work_item_id) ?? []), dependency.depends_on_work_item_id])
        dependentsByItem.set(dependency.depends_on_work_item_id, [...(dependentsByItem.get(dependency.depends_on_work_item_id) ?? []), dependency.work_item_id])
    }

    const latestSafeStart = new Map<string, Date | null>()
    for (const item of openItems) {
        const duration = durations.get(item.id)?.conservative ?? DEFAULT_CONSERVATIVE_DURATION_HOURS
        const horizon = priorityHorizon(item, calendarNow, now, duration)
        latestSafeStart.set(item.id, horizon ? subtractWorkingHours(horizon, duration) : null)
    }
    for (let pass = 0; pass < openItems.length; pass += 1) {
        let changed = false
        for (const dependency of dependencies) {
            if (!openIds.has(dependency.work_item_id) || !openIds.has(dependency.depends_on_work_item_id)) continue
            const dependentStart = latestSafeStart.get(dependency.work_item_id)
            if (!dependentStart) continue
            const prerequisiteDuration = durations.get(dependency.depends_on_work_item_id)?.conservative ?? DEFAULT_CONSERVATIVE_DURATION_HOURS
            const candidate = subtractWorkingHours(dependentStart, prerequisiteDuration)
            const existing = latestSafeStart.get(dependency.depends_on_work_item_id)
            if (!existing || candidate < existing) {
                latestSafeStart.set(dependency.depends_on_work_item_id, candidate)
                changed = true
            }
        }
        if (!changed) break
    }

    const inherited = new Map<string, { rate: number; targetId: string | null }>()
    function inheritedRate(startId: string) {
        const cached = inherited.get(startId)
        if (cached) return cached
        const startDuration = durations.get(startId)?.predicted ?? DEFAULT_DURATION_HOURS
        let best = { rate: 0, targetId: null as string | null }
        const visit = (currentId: string, accumulatedDuration: number, seen: Set<string>) => {
            for (const dependentId of dependentsByItem.get(currentId) ?? []) {
                if (!openIds.has(dependentId) || seen.has(dependentId)) continue
                const nextDuration = accumulatedDuration + (durations.get(dependentId)?.predicted ?? DEFAULT_DURATION_HOURS)
                const candidateRate = (directValue.get(dependentId) ?? 0) / nextDuration
                if (candidateRate > best.rate) best = { rate: candidateRate, targetId: dependentId }
                visit(dependentId, nextDuration, new Set([...seen, dependentId]))
            }
        }
        visit(startId, startDuration, new Set([startId]))
        inherited.set(startId, best)
        return best
    }

    const resultById = new Map<string, AdminQueueResult>()
    for (const item of items) {
        const duration = durations.get(item.id) ?? { predicted: DEFAULT_DURATION_HOURS, conservative: DEFAULT_CONSERVATIVE_DURATION_HOURS, source: "default" as const }
        const inheritedResult = inheritedRate(item.id)
        resultById.set(item.id, {
            work_item_id: item.id,
            queue_position: null,
            queue_reason: item.status === "done" || item.status === "canceled" ? "completed" : item.status === "blocked" ? "blocked" : item.status === "waiting" ? "waiting" : futureStart(item, now) ? "future" : "backlog",
            queue_label: item.status === "done" || item.status === "canceled" ? "Completed" : item.status === "blocked" ? "Blocked" : item.status === "waiting" ? "Waiting" : futureStart(item, now) ? "Starts later" : "Backlog",
            predicted_duration_hours: duration.predicted,
            conservative_duration_hours: duration.conservative,
            duration_source: duration.source,
            direct_priority_value: directValue.get(item.id) ?? 0,
            direct_impact_rate: directRate.get(item.id) ?? 0,
            queue_impact_rate: Math.max(directRate.get(item.id) ?? 0, inheritedResult.rate),
            latest_safe_start: latestSafeStart.get(item.id)?.toISOString() ?? null,
            projected_start: null,
            projected_finish: null,
            projected_lateness_hours: 0,
            enables_work_item_id: inheritedResult.targetId,
            enables_work_item_title: inheritedResult.targetId ? itemById.get(inheritedResult.targetId)?.title ?? null : null,
            blocked_by_ids: (prerequisitesByItem.get(item.id) ?? []).filter((id) => !completedIds.has(id)),
            contributions: contributionsByItem.get(item.id) ?? [],
        })
    }

    const simulatedComplete = new Set(completedIds)
    const remaining = new Set(openItems.map((item) => item.id))
    const projectedGapByKeyResult = new Map(initialGapByKeyResult)
    function projectedDirectValue(itemId: string) {
        return (contributionModelsByItem.get(itemId) ?? []).reduce((total, contribution) => {
            const projectedGap = projectedGapByKeyResult.get(contribution.keyResultId) ?? 0
            return total + contribution.weight * (Math.min(contribution.expectedMovement, projectedGap) / contribution.span) * contribution.pressure * 100
        }, 0)
    }
    function projectedInheritedRate(startId: string) {
        const startDuration = durations.get(startId)?.predicted ?? DEFAULT_DURATION_HOURS
        let best = { rate: 0, targetId: null as string | null }
        const visit = (currentId: string, accumulatedDuration: number, seen: Set<string>) => {
            for (const dependentId of dependentsByItem.get(currentId) ?? []) {
                if (!remaining.has(dependentId) || seen.has(dependentId)) continue
                const nextDuration = accumulatedDuration + (durations.get(dependentId)?.predicted ?? DEFAULT_DURATION_HOURS)
                const candidateRate = projectedDirectValue(dependentId) / nextDuration
                if (candidateRate > best.rate) best = { rate: candidateRate, targetId: dependentId }
                visit(dependentId, nextDuration, new Set([...seen, dependentId]))
            }
        }
        visit(startId, startDuration, new Set([startId]))
        return best
    }
    function projectedEffectiveRate(itemId: string) {
        const direct = projectedDirectValue(itemId) / (durations.get(itemId)?.predicted ?? DEFAULT_DURATION_HOURS)
        const inheritedResult = projectedInheritedRate(itemId)
        return { rate: Math.max(direct, inheritedResult.rate), direct, inherited: inheritedResult }
    }
    let cursor = now
    let position = 1
    let safety = 0
    while (remaining.size && safety < items.length * 2) {
        const ready = [...remaining].flatMap((id) => {
            const item = itemById.get(id)!
            if (item.status !== "todo" && item.status !== "doing") return []
            if (futureStart(item, cursor)) return []
            const blocked = (prerequisitesByItem.get(id) ?? []).some((dependencyId) => !simulatedComplete.has(dependencyId))
            return blocked ? [] : [item]
        })
        if (!ready.length) break

        const forced = ready.filter((item) => {
            const start = latestSafeStart.get(item.id)
            return start && start <= cursor
        }).sort((left, right) => compareFiniteDates(latestSafeStart.get(left.id) ?? null, latestSafeStart.get(right.id) ?? null)
            || Number(right.severity === "critical") - Number(left.severity === "critical")
            || projectedEffectiveRate(right.id).rate - projectedEffectiveRate(left.id).rate)

        let selected: AdminQueueWorkInput | undefined = forced[0]
        let reason: AdminQueueResult["queue_reason"] = "forced"
        let label = selected?.kind === "maintenance" && selected.severity === "critical" ? "Critical maintenance" : "Deadline at risk"

        if (!selected) {
            const upcomingStarts = ready.flatMap((item) => latestSafeStart.get(item.id) ? [latestSafeStart.get(item.id)!] : [])
            const nextSafeStart = upcomingStarts.length ? new Date(Math.min(...upcomingStarts.map((date) => date.getTime()))) : null
            const safeHours = nextSafeStart ? workingHoursBetween(cursor, nextSafeStart) : Number.POSITIVE_INFINITY
            const continuations = ready.filter((item) => item.status === "doing" && (durations.get(item.id)?.conservative ?? DEFAULT_CONSERVATIVE_DURATION_HOURS) <= safeHours)
                .sort((left, right) => projectedEffectiveRate(right.id).rate - projectedEffectiveRate(left.id).rate || left.updated_at.localeCompare(right.updated_at))
            selected = continuations[0]
            if (selected) {
                reason = "continuation"
                label = "Continue"
            }

            const impactCandidates = ready.filter((item) => projectedEffectiveRate(item.id).rate > 0 && (durations.get(item.id)?.conservative ?? DEFAULT_CONSERVATIVE_DURATION_HOURS) <= safeHours)
                .sort((left, right) => projectedEffectiveRate(right.id).rate - projectedEffectiveRate(left.id).rate
                    || projectedDirectValue(right.id) - projectedDirectValue(left.id)
                    || left.created_at.localeCompare(right.created_at))
            selected = selected ?? impactCandidates[0]
            if (selected && reason !== "continuation") {
                const projected = projectedEffectiveRate(selected.id)
                if (projected.inherited.rate > projected.direct && projected.inherited.targetId) {
                    reason = "enables"
                    label = `Unlocks ${itemById.get(projected.inherited.targetId)?.title ?? "higher-impact work"}`
                } else {
                    reason = "impact"
                    label = "Highest impact"
                }
            }
            if (!selected) {
                const obligations = ready.filter((item) => latestSafeStart.get(item.id)).sort((left, right) => compareFiniteDates(latestSafeStart.get(left.id) ?? null, latestSafeStart.get(right.id) ?? null))
                selected = obligations[0] ?? ready.sort((left, right) => schedulingPriority(left) - schedulingPriority(right) || left.created_at.localeCompare(right.created_at))[0]
                reason = obligations[0] ? "obligation" : "backlog"
                label = obligations[0] ? "Do next" : "Backlog"
            }
        }

        const result = resultById.get(selected.id)!
        result.queue_impact_rate = projectedEffectiveRate(selected.id).rate
        result.queue_position = position
        result.queue_reason = reason
        result.queue_label = label
        const projectedFinish = addWorkingHours(cursor, durations.get(selected.id)?.conservative ?? DEFAULT_CONSERVATIVE_DURATION_HOURS)
        remaining.delete(selected.id)
        simulatedComplete.add(selected.id)
        for (const contribution of contributionModelsByItem.get(selected.id) ?? []) {
            const gap = projectedGapByKeyResult.get(contribution.keyResultId) ?? 0
            projectedGapByKeyResult.set(contribution.keyResultId, Math.max(0, gap - contribution.expectedMovement))
        }
        cursor = projectedFinish
        position += 1
        safety += 1
    }

    for (const id of remaining) {
        const result = resultById.get(id)!
        const item = itemById.get(id)!
        if (item.status === "blocked") {
            result.queue_reason = "blocked"
            result.queue_label = "Blocked"
        } else if (item.status === "waiting") {
            result.queue_reason = "waiting"
            result.queue_label = "Waiting"
        } else if (futureStart(item, now)) {
            result.queue_reason = "future"
            result.queue_label = "Starts later"
        } else if (result.blocked_by_ids.length) {
            result.queue_reason = "blocked"
            result.queue_label = "Waiting for dependencies"
        }
    }

    const ownerAvailableAt = new Map<string, Date>()
    const projectedFinishByItem = new Map<string, Date>()
    const rankedResults = [...resultById.values()].filter((result) => result.queue_position !== null).sort((left, right) => left.queue_position! - right.queue_position!)
    for (const result of rankedResults) {
        const item = itemById.get(result.work_item_id)!
        result.projected_start = null
        result.projected_finish = null
        result.projected_lateness_hours = 0
        if (!item.execution_owner_id) {
            result.queue_reason = "unassigned"
            result.queue_label = "Needs owner"
            continue
        }

        const ownerReady = ownerAvailableAt.get(item.execution_owner_id) ?? now
        const prerequisites = prerequisitesByItem.get(item.id) ?? []
        if (prerequisites.some((dependencyId) => openIds.has(dependencyId) && !projectedFinishByItem.has(dependencyId))) {
            result.queue_reason = "blocked"
            result.queue_label = "Waiting for forecast"
            continue
        }
        const dependencyReady = prerequisites.reduce((latest, dependencyId) => {
            const finish = projectedFinishByItem.get(dependencyId)
            return finish && finish > latest ? finish : latest
        }, now)
        const plannedReady = item.planned_start_date ? new Date(`${item.planned_start_date}T09:00:00.000Z`) : now
        const projectedStart = normalizeForward(new Date(Math.max(now.getTime(), ownerReady.getTime(), dependencyReady.getTime(), plannedReady.getTime())))
        const duration = durations.get(item.id)?.conservative ?? DEFAULT_CONSERVATIVE_DURATION_HOURS
        const projectedFinish = addWorkingHours(projectedStart, duration)
        const safeStart = latestSafeStart.get(item.id)
        const horizon = safeStart ? addWorkingHours(safeStart, duration) : null
        result.projected_start = projectedStart.toISOString()
        result.projected_finish = projectedFinish.toISOString()
        result.projected_lateness_hours = horizon && projectedFinish > horizon ? workingHoursBetween(horizon, projectedFinish) : 0
        if (item.kind !== "maintenance" || item.severity !== "critical") {
            if (result.projected_lateness_hours > 0) {
                result.queue_reason = "forced"
                result.queue_label = "Deadline at risk"
            } else if (result.queue_reason === "forced") {
                result.queue_label = "Do next"
            }
        }
        ownerAvailableAt.set(item.execution_owner_id, projectedFinish)
        projectedFinishByItem.set(item.id, projectedFinish)
    }

    return items.map((item) => resultById.get(item.id)!).sort((left, right) => {
        if (left.queue_position !== null && right.queue_position !== null) return left.queue_position - right.queue_position
        if (left.queue_position !== null) return -1
        if (right.queue_position !== null) return 1
        const leftItem = itemById.get(left.work_item_id)!
        const rightItem = itemById.get(right.work_item_id)!
        const leftClosed = leftItem.status === "done" || leftItem.status === "canceled" ? 1 : 0
        const rightClosed = rightItem.status === "done" || rightItem.status === "canceled" ? 1 : 0
        return leftClosed - rightClosed || rightItem.updated_at.localeCompare(leftItem.updated_at)
    })
}
