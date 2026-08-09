import assert from "node:assert/strict"
import test from "node:test"
import { addWorkingHours, buildAdminWorkQueue, okrAttention, subtractWorkingHours, workingHoursBetween, type AdminQueueOkrInput, type AdminQueueWorkInput } from "../lib/admin/work-priority.ts"

const NOW = "2026-08-10T09:00:00.000Z"

function work(id: string, overrides: Partial<AdminQueueWorkInput> = {}): AdminQueueWorkInput {
    return {
        id,
        title: id,
        status: "todo",
        priority: 4,
        priority_override: null,
        kind: "okr_action",
        severity: null,
        planned_start_date: null,
        due_date: null,
        due_time: null,
        actual_start_at: null,
        actual_completed_at: null,
        created_at: "2026-08-01T09:00:00.000Z",
        updated_at: "2026-08-01T09:00:00.000Z",
        ...overrides,
    }
}

function okr(id: string, resultId: string, overrides: Partial<AdminQueueOkrInput["key_results"][number]> = {}): AdminQueueOkrInput {
    return {
        id,
        objective: `Objective ${id}`,
        status: "active",
        period_start: "2026-08-03",
        period_end: "2026-08-21",
        key_results: [{
            id: resultId,
            name: `Result ${resultId}`,
            comparator: "at_least",
            baseline_value: 0,
            target_value: 100,
            current_value: 0,
            progress: 0,
            unit: "percentage",
            currency_code: null,
            ...overrides,
        }],
    }
}

function queue(input: {
    items: AdminQueueWorkInput[]
    okrs?: AdminQueueOkrInput[]
    links?: Array<{ work_item_id: string; key_result_id: string; expected_movement: number | null; impact_hypothesis: string | null }>
    dependencies?: Array<{ work_item_id: string; depends_on_work_item_id: string }>
}) {
    return buildAdminWorkQueue({ items: input.items, okrs: input.okrs ?? [], links: input.links ?? [], dependencies: input.dependencies ?? [], now: NOW })
}

test("working-time arithmetic ignores nights and weekends", () => {
    assert.equal(workingHoursBetween("2026-08-07T16:00:00.000Z", "2026-08-10T11:00:00.000Z"), 3)
    assert.equal(addWorkingHours("2026-08-07T16:00:00.000Z", 3).toISOString(), "2026-08-10T11:00:00.000Z")
    assert.equal(subtractWorkingHours("2026-08-10T11:00:00.000Z", 3).toISOString(), "2026-08-07T16:00:00.000Z")
})

test("KR attention is scale-free and increases when progress trails elapsed time", () => {
    assert.equal(okrAttention({ progress: 50, periodStart: "2026-08-03", periodEnd: "2026-08-14", now: "2026-08-03T09:00:00.000Z" }), 0.5)
    assert.equal(okrAttention({ progress: 50, periodStart: "2026-08-03", periodEnd: "2026-08-14", now: "2026-08-10T09:00:00.000Z" }), 1)
    assert.equal(okrAttention({ progress: 100, periodStart: "2026-08-03", periodEnd: "2026-08-14", now: "2026-08-20T09:00:00.000Z" }), 0)
    assert.equal(okrAttention({ progress: 50, periodStart: "2026-08-03", periodEnd: "2026-08-07", now: "2026-08-10T09:00:00.000Z" }), Number.POSITIVE_INFINITY)
})

test("mixed-unit KRs rank by normalized movement rather than raw unit size", () => {
    const results = queue({
        items: [work("revenue"), work("retention")],
        okrs: [
            okr("growth", "revenue-kr", { baseline_value: 0, target_value: 100_000, current_value: 5_000, progress: 5, unit: "currency", currency_code: "EUR" }),
            okr("quality", "retention-kr", { baseline_value: 0, target_value: 100, current_value: 20, progress: 20 }),
        ],
        links: [
            { work_item_id: "revenue", key_result_id: "revenue-kr", expected_movement: 10_000, impact_hypothesis: "Convert qualified pipeline" },
            { work_item_id: "retention", key_result_id: "retention-kr", expected_movement: 20, impact_hypothesis: "Remove top churn cause" },
        ],
    })
    assert.deepEqual(results.filter((item) => item.queue_position !== null).map((item) => item.work_item_id), ["retention", "revenue"])
})

test("impact per predicted working hour can beat a larger absolute movement", () => {
    const history = [
        work("long-1", { status: "done", kind: "standard", actual_start_at: "2026-07-20T09:00:00.000Z", actual_completed_at: "2026-07-20T17:00:00.000Z" }),
        work("long-2", { status: "done", kind: "standard", actual_start_at: "2026-07-21T09:00:00.000Z", actual_completed_at: "2026-07-21T17:00:00.000Z" }),
        work("long-3", { status: "done", kind: "standard", actual_start_at: "2026-07-22T09:00:00.000Z", actual_completed_at: "2026-07-22T17:00:00.000Z" }),
        work("short-1", { status: "done", actual_start_at: "2026-07-20T09:00:00.000Z", actual_completed_at: "2026-07-20T10:00:00.000Z" }),
        work("short-2", { status: "done", actual_start_at: "2026-07-21T09:00:00.000Z", actual_completed_at: "2026-07-21T10:00:00.000Z" }),
        work("short-3", { status: "done", actual_start_at: "2026-07-22T09:00:00.000Z", actual_completed_at: "2026-07-22T10:00:00.000Z" }),
    ]
    const results = queue({
        items: [work("large", { kind: "standard" }), work("quick"), ...history],
        okrs: [okr("growth", "growth-kr")],
        links: [
            { work_item_id: "large", key_result_id: "growth-kr", expected_movement: 30, impact_hypothesis: "Large project" },
            { work_item_id: "quick", key_result_id: "growth-kr", expected_movement: 20, impact_hypothesis: "Quick win" },
        ],
    })
    assert.equal(results[0].work_item_id, "quick")
    assert.ok(results.find((item) => item.work_item_id === "quick")!.predicted_duration_hours < results.find((item) => item.work_item_id === "large")!.predicted_duration_hours)
})

test("Must do now is forced, while tomorrow is a safe-start constraint rather than an automatic first place", () => {
    const objective = okr("growth", "growth-kr")
    const highImpactLink = { work_item_id: "impact", key_result_id: "growth-kr", expected_movement: 80, impact_hypothesis: "Move most of the gap" }
    const forced = queue({ items: [work("urgent", { priority: 1 }), work("impact")], okrs: [objective], links: [highImpactLink] })
    assert.equal(forced[0].work_item_id, "urgent")
    assert.equal(forced[0].queue_reason, "forced")

    const tomorrow = queue({ items: [work("tomorrow", { priority: 2 }), work("impact")], okrs: [objective], links: [highImpactLink] })
    assert.equal(tomorrow[0].work_item_id, "impact")
    assert.equal(tomorrow[0].queue_reason, "impact")
})

test("a manual priority override replaces the system timing seed", () => {
    const objective = okr("growth", "growth-kr")
    const highImpactLink = { work_item_id: "impact", key_result_id: "growth-kr", expected_movement: 80, impact_hypothesis: "Move most of the gap" }
    const systemGenerated = queue({ items: [work("system", { priority: 4 }), work("impact")], okrs: [objective], links: [highImpactLink] })
    assert.equal(systemGenerated[0].work_item_id, "impact")

    const overridden = queue({ items: [work("override", { priority: 4, priority_override: 1 }), work("impact")], okrs: [objective], links: [highImpactLink] })
    assert.equal(overridden[0].work_item_id, "override")
    assert.equal(overridden[0].queue_label, "Deadline at risk")
})

test("queue results expose conservative finish forecasts and working-hour lateness", () => {
    const results = queue({
        items: [
            work("first", { priority: 2, created_at: "2026-08-01T09:00:00.000Z" }),
            work("second", { priority: 2, created_at: "2026-08-02T09:00:00.000Z" }),
            work("third", { priority: 2, created_at: "2026-08-03T09:00:00.000Z" }),
        ],
    })
    assert.equal(results[0].projected_start, NOW)
    assert.equal(results[0].projected_finish, "2026-08-10T15:00:00.000Z")
    assert.equal(results[0].projected_lateness_hours, 0)
    assert.equal(results[1].projected_finish, "2026-08-11T13:00:00.000Z")
    assert.equal(results[1].projected_lateness_hours, 0)
    assert.equal(results[2].projected_finish, "2026-08-12T11:00:00.000Z")
    assert.equal(results[2].projected_lateness_hours, 2)
})

test("tomorrow still means the next workday when the queue is viewed after today's workday", () => {
    const results = buildAdminWorkQueue({
        items: [work("tomorrow", { priority: 2 })],
        okrs: [],
        links: [],
        dependencies: [],
        now: "2026-08-10T18:00:00.000Z",
    })
    assert.equal(results[0].latest_safe_start, "2026-08-11T11:00:00.000Z")
})

test("a prerequisite inherits enough downstream value to unlock high-impact work first", () => {
    const results = queue({
        items: [work("prerequisite"), work("high-impact"), work("low-impact")],
        okrs: [okr("growth", "growth-kr")],
        links: [
            { work_item_id: "high-impact", key_result_id: "growth-kr", expected_movement: 100, impact_hypothesis: "Completes the target" },
            { work_item_id: "low-impact", key_result_id: "growth-kr", expected_movement: 10, impact_hypothesis: "Small improvement" },
        ],
        dependencies: [{ work_item_id: "high-impact", depends_on_work_item_id: "prerequisite" }],
    })
    assert.equal(results[0].work_item_id, "prerequisite")
    assert.equal(results[0].queue_reason, "enables")
    assert.equal(results[0].enables_work_item_id, "high-impact")
    assert.deepEqual(results.filter((item) => item.queue_position !== null).map((item) => item.work_item_id), ["prerequisite", "high-impact", "low-impact"])
})

test("the rolling queue reduces later value when earlier work is forecast to close the same KR gap", () => {
    const objective = okr("growth", "primary-kr")
    objective.key_results.push({
        id: "secondary-kr",
        name: "Secondary result",
        comparator: "at_least",
        baseline_value: 0,
        target_value: 100,
        current_value: 0,
        progress: 0,
        unit: "percentage",
        currency_code: null,
    })
    const results = queue({
        items: [
            work("primary-a", { created_at: "2026-08-01T09:00:00.000Z" }),
            work("primary-b", { created_at: "2026-08-02T09:00:00.000Z" }),
            work("secondary", { created_at: "2026-08-03T09:00:00.000Z" }),
        ],
        okrs: [objective],
        links: [
            { work_item_id: "primary-a", key_result_id: "primary-kr", expected_movement: 80, impact_hypothesis: "First route to the target" },
            { work_item_id: "primary-b", key_result_id: "primary-kr", expected_movement: 80, impact_hypothesis: "Second route to the same target" },
            { work_item_id: "secondary", key_result_id: "secondary-kr", expected_movement: 30, impact_hypothesis: "Move another result" },
        ],
    })
    assert.deepEqual(results.filter((item) => item.queue_position !== null).map((item) => item.work_item_id), ["primary-a", "secondary", "primary-b"])
    assert.ok(results.find((item) => item.work_item_id === "primary-b")!.queue_impact_rate < results.find((item) => item.work_item_id === "secondary")!.queue_impact_rate)
})

test("in-progress work is continued when doing so cannot make an upcoming obligation late", () => {
    const results = queue({
        items: [work("in-progress", { status: "doing" }), work("new-high-impact")],
        okrs: [okr("growth", "growth-kr")],
        links: [{ work_item_id: "new-high-impact", key_result_id: "growth-kr", expected_movement: 100, impact_hypothesis: "High impact new task" }],
    })
    assert.equal(results[0].work_item_id, "in-progress")
    assert.equal(results[0].queue_reason, "continuation")
})

test("a completed prerequisite outside the Admin queue does not leave Admin work falsely blocked", () => {
    const results = queue({
        items: [work("admin-work")],
        dependencies: [{ work_item_id: "admin-work", depends_on_work_item_id: "external-done", depends_on_completed: true }],
    })
    assert.equal(results[0].queue_position, 1)
    assert.deepEqual(results[0].blocked_by_ids, [])
})
