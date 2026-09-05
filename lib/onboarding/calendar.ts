export type OnboardingCalendarResponse = {
    date: string
    time: string
    timezone: string
    startsAt: string
}

function record(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}

export function isValidCalendarDate(value: string) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    if (!match) return false
    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    const parsed = new Date(Date.UTC(year, month - 1, day))
    return parsed.getUTCFullYear() === year
        && parsed.getUTCMonth() === month - 1
        && parsed.getUTCDate() === day
}

export function isValidCalendarTime(value: string) {
    return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
}

export function isValidCalendarTimezone(value: string) {
    if (!value || value.length > 100) return false
    try {
        new Intl.DateTimeFormat("en", { timeZone: value }).format()
        return true
    } catch {
        return false
    }
}

export function validateCalendarSelection(input: { date?: unknown; time?: unknown; timezone?: unknown }) {
    const date = String(input.date ?? "").trim()
    const time = String(input.time ?? "").trim().slice(0, 5)
    const timezone = String(input.timezone ?? "").trim()
    if (!isValidCalendarDate(date)) throw new Error("Choose a valid date.")
    if (!isValidCalendarTime(time)) throw new Error("Choose a valid time.")
    if (!isValidCalendarTimezone(timezone)) throw new Error("Your timezone could not be recognised. Refresh the page and try again.")
    return { date, time, timezone }
}

export function normalizeCalendarResponse(value: unknown): OnboardingCalendarResponse | null {
    const source = record(value)
    if (!source) return null
    try {
        const selection = validateCalendarSelection(source)
        const startsAt = String(source.startsAt ?? source.starts_at ?? "").trim()
        if (!startsAt || Number.isNaN(new Date(startsAt).getTime())) return null
        return { ...selection, startsAt }
    } catch {
        return null
    }
}

export function formatCalendarSelection(value: unknown, locale = "en-IE") {
    const source = record(value)
    if (!source) return null
    try {
        const selection = validateCalendarSelection(source)
        const dateLabel = new Intl.DateTimeFormat(locale, {
            dateStyle: "full",
            timeZone: "UTC",
        }).format(new Date(`${selection.date}T00:00:00.000Z`))
        return `${dateLabel} at ${selection.time} (${selection.timezone})`
    } catch {
        return null
    }
}

export function formatCalendarResponse(value: unknown, locale = "en-IE") {
    const response = normalizeCalendarResponse(value)
    if (!response) return null
    try {
        return `${new Intl.DateTimeFormat(locale, {
            dateStyle: "full",
            timeStyle: "short",
            timeZone: response.timezone,
        }).format(new Date(response.startsAt))} (${response.timezone})`
    } catch {
        return formatCalendarSelection(response, locale)
    }
}
