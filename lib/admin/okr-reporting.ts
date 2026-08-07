export type OkrReportingCadence = "daily" | "weekly" | "manual"

export type OkrReportingMeasurement = {
    id: string
    value: number
    reported_on: string
    measured_at: string
}

export type OkrReportingDayState = "reported" | "due" | "missed" | "before" | "future" | "none"

export type OkrReportingDay<T extends OkrReportingMeasurement = OkrReportingMeasurement> = {
    date: string
    state: OkrReportingDayState
    measurement: T | null
    reportCount: number
}

const DAY_MS = 86_400_000

function dateFromKey(value: string) {
    return new Date(`${value}T00:00:00.000Z`)
}

export function utcDateKey(value: Date) {
    return value.toISOString().slice(0, 10)
}

export function addUtcDays(value: string, days: number) {
    return utcDateKey(new Date(dateFromKey(value).getTime() + days * DAY_MS))
}

export function startOfUtcWeek(value: string) {
    const date = dateFromKey(value)
    const mondayOffset = (date.getUTCDay() + 6) % 7
    return addUtcDays(value, -mondayOffset)
}

export function endOfUtcWeek(value: string) {
    return addUtcDays(startOfUtcWeek(value), 6)
}

export function okrReportingWindow(today: string, length = 35) {
    return Array.from({ length }, (_, index) => addUtcDays(today, index - length + 1))
}

export function okrReportingPeriod(startDate: string, periodIndex: number, length = 35) {
    const periodStart = addUtcDays(startDate, Math.max(0, periodIndex) * length)
    return Array.from({ length }, (_, index) => addUtcDays(periodStart, index))
}

export function okrReportingPeriodIndex(startDate: string, today: string, length = 35) {
    const elapsedDays = Math.floor((dateFromKey(today).getTime() - dateFromKey(startDate).getTime()) / DAY_MS)
    return Math.max(0, Math.floor(elapsedDays / length))
}

export function latestOkrMeasurementsByDay<T extends OkrReportingMeasurement>(measurements: T[]) {
    const grouped = new Map<string, T[]>()
    for (const measurement of measurements) grouped.set(measurement.reported_on, [...(grouped.get(measurement.reported_on) ?? []), measurement])
    const latest = new Map<string, T>()
    for (const [date, rows] of grouped) {
        latest.set(date, [...rows].sort((left, right) => left.measured_at.localeCompare(right.measured_at)).at(-1)!)
    }
    return { grouped, latest }
}

export function buildOkrReportingDays<T extends OkrReportingMeasurement>({
    cadence,
    reportingStartedOn,
    measurements,
    today,
    length = 35,
    windowStart,
}: {
    cadence: OkrReportingCadence | null
    reportingStartedOn: string | null
    measurements: T[]
    today: string
    length?: number
    windowStart?: string
}): OkrReportingDay<T>[] {
    const { grouped, latest } = latestOkrMeasurementsByDay(measurements)
    const reportedWeeks = new Set(measurements
        .filter((measurement) => !reportingStartedOn || measurement.reported_on >= reportingStartedOn)
        .map((measurement) => startOfUtcWeek(measurement.reported_on)))

    const dates = windowStart
        ? Array.from({ length }, (_, index) => addUtcDays(windowStart, index))
        : okrReportingWindow(today, length)

    return dates.map((date) => {
        const measurement = latest.get(date) ?? null
        const reportCount = grouped.get(date)?.length ?? 0
        let state: OkrReportingDayState = "none"

        if (date > today) state = "future"
        else if (measurement) state = "reported"
        else if (!cadence || !reportingStartedOn || date < reportingStartedOn) state = "before"
        else if (cadence === "daily") state = date === today ? "due" : "missed"
        else if (cadence === "weekly") {
            const weekStart = startOfUtcWeek(date)
            const weekEnd = endOfUtcWeek(date)
            if (!reportedWeeks.has(weekStart)) {
                if (date === today && weekEnd >= today) state = "due"
                else if (date === weekEnd && weekEnd < today) state = "missed"
            }
        }

        return { date, state, measurement, reportCount }
    })
}

export function okrReportingCadenceLabel(cadence: OkrReportingCadence | null) {
    if (cadence === "daily") return "Daily"
    if (cadence === "weekly") return "Weekly"
    if (cadence === "manual") return "Manual"
    return "Set cadence"
}
