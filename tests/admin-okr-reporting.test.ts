import assert from "node:assert/strict"
import test from "node:test"
import { buildOkrReportingDays, latestOkrMeasurementsByDay, okrReportingPeriod, okrReportingPeriodIndex, okrReportingWindow, startOfUtcWeek } from "../lib/admin/okr-reporting.ts"

const today = "2026-08-05"

function measurement(id: string, reportedOn: string, value: number, measuredAt = `${reportedOn}T12:00:00.000Z`) {
    return { id, reported_on: reportedOn, value, measured_at: measuredAt }
}

test("the accountability window contains the trailing 35 dates ending today", () => {
    const dates = okrReportingWindow(today)
    assert.equal(dates.length, 35)
    assert.equal(dates[0], "2026-07-02")
    assert.equal(dates.at(-1), today)
})

test("reporting periods are fixed 35-day windows anchored to the Objective start", () => {
    assert.deepEqual(okrReportingPeriod("2026-08-01", 0).slice(0, 2), ["2026-08-01", "2026-08-02"])
    assert.equal(okrReportingPeriod("2026-08-01", 0).at(-1), "2026-09-04")
    assert.equal(okrReportingPeriod("2026-08-01", 1)[0], "2026-09-05")
    assert.equal(okrReportingPeriodIndex("2026-08-01", "2026-09-04"), 0)
    assert.equal(okrReportingPeriodIndex("2026-08-01", "2026-09-05"), 1)
})

test("an anchored reporting window keeps future dates visible", () => {
    const days = buildOkrReportingDays({ cadence: "daily", reportingStartedOn: "2026-08-01", measurements: [], today: "2026-08-05", windowStart: "2026-08-01", length: 7 })
    assert.deepEqual(days.map((day) => day.state), ["missed", "missed", "missed", "missed", "due", "future", "future"])
})

test("daily cadence distinguishes before, reported, missed, and due dates", () => {
    const days = buildOkrReportingDays({ cadence: "daily", reportingStartedOn: "2026-08-02", measurements: [measurement("one", "2026-08-03", 20)], today, length: 5 })
    assert.deepEqual(days.map((day) => [day.date, day.state]), [
        ["2026-08-01", "before"],
        ["2026-08-02", "missed"],
        ["2026-08-03", "reported"],
        ["2026-08-04", "missed"],
        ["2026-08-05", "due"],
    ])
})

test("weekly cadence uses Monday to Sunday and only marks a completed empty week missed", () => {
    assert.equal(startOfUtcWeek("2026-08-05"), "2026-08-03")
    const missing = buildOkrReportingDays({ cadence: "weekly", reportingStartedOn: "2026-07-20", measurements: [], today, length: 17 })
    assert.equal(missing.find((day) => day.date === "2026-07-26")?.state, "missed")
    assert.equal(missing.find((day) => day.date === "2026-08-02")?.state, "missed")
    assert.equal(missing.find((day) => day.date === today)?.state, "due")

    const reported = buildOkrReportingDays({ cadence: "weekly", reportingStartedOn: "2026-07-20", measurements: [measurement("one", "2026-07-22", 20)], today, length: 17 })
    assert.equal(reported.find((day) => day.date === "2026-07-22")?.state, "reported")
    assert.equal(reported.find((day) => day.date === "2026-07-26")?.state, "none")
})

test("manual cadence records history without creating due or missed dates", () => {
    const days = buildOkrReportingDays({ cadence: "manual", reportingStartedOn: "2026-08-01", measurements: [measurement("one", "2026-08-03", 20)], today, length: 5 })
    assert.deepEqual(days.map((day) => day.state), ["none", "none", "reported", "none", "none"])
})

test("multiple reports remain counted while the latest report drives the calendar value", () => {
    const first = measurement("one", "2026-08-03", 20, "2026-08-03T09:00:00.000Z")
    const latest = measurement("two", "2026-08-03", 25, "2026-08-03T17:00:00.000Z")
    const grouped = latestOkrMeasurementsByDay([latest, first])
    assert.equal(grouped.grouped.get("2026-08-03")?.length, 2)
    assert.equal(grouped.latest.get("2026-08-03")?.value, 25)
    const day = buildOkrReportingDays({ cadence: "daily", reportingStartedOn: "2026-08-01", measurements: [latest, first], today, length: 5 }).find((item) => item.date === "2026-08-03")
    assert.equal(day?.reportCount, 2)
    assert.equal(day?.measurement?.value, 25)
})

test("legacy reports remain visible before cadence tracking begins", () => {
    const days = buildOkrReportingDays({ cadence: "daily", reportingStartedOn: today, measurements: [measurement("legacy", "2026-08-03", 20)], today, length: 5 })
    assert.equal(days.find((day) => day.date === "2026-08-03")?.state, "reported")
    assert.equal(days.find((day) => day.date === "2026-08-04")?.state, "before")
    assert.equal(days.find((day) => day.date === today)?.state, "due")
})

test("a report from before weekly tracking does not satisfy the first tracked week", () => {
    const days = buildOkrReportingDays({ cadence: "weekly", reportingStartedOn: "2026-08-05", measurements: [measurement("legacy", "2026-08-04", 20)], today: "2026-08-09", length: 7 })
    assert.equal(days.find((day) => day.date === "2026-08-04")?.state, "reported")
    assert.equal(days.find((day) => day.date === "2026-08-09")?.state, "due")
})

test("a future reporting start leaves the current window before tracking", () => {
    const days = buildOkrReportingDays({ cadence: "daily", reportingStartedOn: "2026-08-08", measurements: [], today, length: 5 })
    assert.ok(days.every((day) => day.state === "before"))
})
