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

export function formatOkrMetricValue(value: number, unit: OkrMetricUnit, currencyCode = "USD") {
    if (unit === "percentage") return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)}%`
    if (unit === "currency") return new Intl.NumberFormat("en-US", { style: "currency", currency: currencyCode.toUpperCase(), maximumFractionDigits: 2 }).format(value)
    if (unit === "duration") return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)} hours`
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)
}
