export type OkrMetricComparator = "at_least" | "at_most"
export type OkrMetricUnit = "number" | "percentage" | "currency" | "duration"

export function okrKeyResultProgress({ baseline, target, current }: { baseline: number; target: number; current: number }) {
    if (![baseline, target, current].every(Number.isFinite)) return 0
    if (target === baseline) return current === target ? 100 : 0
    return Math.max(0, Math.min(100, ((current - baseline) / (target - baseline)) * 100))
}

export function okrTargetMet(comparator: OkrMetricComparator, current: number, target: number) {
    return comparator === "at_most" ? current <= target : current >= target
}

export function okrGap(comparator: OkrMetricComparator, current: number, target: number) {
    return comparator === "at_most" ? Math.max(0, current - target) : Math.max(0, target - current)
}

export function okrAttainment(progressValues: number[]) {
    if (!progressValues.length) return 0
    return progressValues.reduce((total, value) => total + value, 0) / progressValues.length
}

export function okrTrendScale({
    baseline,
    target,
    values,
    comparator,
}: {
    baseline: number
    target: number
    values: number[]
    comparator: OkrMetricComparator
}) {
    const finiteValues = values.filter(Number.isFinite)
    const observedMin = Math.min(baseline, target, ...finiteValues)
    const observedMax = Math.max(baseline, target, ...finiteValues)
    const goalSpan = Math.max(Math.abs(target - baseline), Math.abs(baseline) * 0.1, 1)

    let min: number
    let max: number

    if (comparator === "at_most") {
        min = observedMin < target
            ? observedMin - Math.max((target - observedMin) * 0.15, goalSpan * 0.05)
            : target
        if (min <= goalSpan * 0.1) min = 0

        const upperHeadroom = Math.max(goalSpan * 0.2, observedMax > baseline ? goalSpan * 0.1 : 0)
        max = Math.max(baseline + upperHeadroom, observedMax + (observedMax > baseline ? upperHeadroom : 0))
    } else {
        max = observedMax > target
            ? observedMax + Math.max((observedMax - target) * 0.15, goalSpan * 0.05)
            : target

        min = Math.min(observedMin, baseline - goalSpan * 0.25)
        if (min <= goalSpan * 0.1) min = 0
        else min = Math.max(0, min)
    }

    if (max <= min) max = min + goalSpan
    return { min, max, showZero: min === 0 }
}

export function formatOkrMetricValue(value: number, unit: OkrMetricUnit, currencyCode = "USD") {
    if (unit === "percentage") return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)}%`
    if (unit === "currency") return new Intl.NumberFormat("en-US", { style: "currency", currency: currencyCode.toUpperCase(), maximumFractionDigits: 2 }).format(value)
    if (unit === "duration") return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)} hours`
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)
}
