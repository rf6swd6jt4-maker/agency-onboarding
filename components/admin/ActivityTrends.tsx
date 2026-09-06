"use client"

import { useState } from "react"
import { FilterRail, FilterRailButton } from "@/components/panel/FilterRail"
import { TrendChart } from "@/components/ui"
import { ACTIVITY_RANGES, formatActivityCount, type AdminActivityRange, type AdminActivityMetric, type AdminActivityMetricBundle } from "@/lib/admin/activity-metrics"

function metricValue(metric: AdminActivityMetric, value: number | null) {
    if (value === null) return "—"
    return metric.unit === "percentage" ? `${value.toFixed(value > 0 && value < 10 ? 1 : 0)}%` : formatActivityCount(value)
}

function metricTime(value: string, detailed = false, range: AdminActivityRange = "24h") {
    return new Intl.DateTimeFormat("en-IE", detailed
        ? { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin" }
        : range === "30d" || range === "7d" ? { day: "numeric", month: "short", timeZone: "Europe/Dublin" } : { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin" }
    ).format(new Date(value))
}

function ActivityMetricCard({ metric, range }: { metric: AdminActivityMetric; range: AdminActivityRange }) {
    const maximum = metric.unit === "percentage" ? 100 : Math.max(1, ...metric.points.map((point) => point.value ?? 0))
    const labelIndexes = [0, Math.floor((metric.points.length - 1) / 2), metric.points.length - 1]
    return <article className="min-w-0 rounded-xl border border-neutral-800 bg-black px-4 pb-3 pt-4">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="text-sm font-medium text-neutral-200">{metric.title}</h2><p className="mt-1 min-h-10 text-xs leading-5 text-neutral-600">{metric.description}</p></div><div className="shrink-0 text-right"><p className={`text-2xl font-semibold tabular-nums ${metric.tone === "red" ? "text-red-400" : "text-white"}`}>{metricValue(metric, metric.currentValue)}</p><p className="mt-0.5 text-[10px] text-neutral-600">{ACTIVITY_RANGES[range].label}{metric.unit === "percentage" ? " average" : ""}</p></div></div>
        <div className="mt-2"><TrendChart
            key={range}
            reveal
            ariaLabel={`${metric.title}: ${ACTIVITY_RANGES[range].label}`}
            points={metric.points.flatMap((point, index) => point.value === null ? [] : [{
                id: `${metric.key}-${point.startsAt}`, position: index, value: point.value,
                breakBefore: index > 0 && metric.points[index - 1].value === null,
                ariaLabel: `${metricTime(point.startsAt, true)}: ${metricValue(metric, point.value)}${metric.unit === "percentage" ? `, ${point.failures} failures / ${point.samples} completed` : ` moving average, ${point.rawValue} in bucket`}`,
                tooltipLabel: metricTime(point.startsAt, true),
                tooltipValue: metric.unit === "percentage" ? `${metricValue(metric, point.value)} · ${formatActivityCount(point.failures)}/${formatActivityCount(point.samples)} calls` : `${metricValue(metric, point.value)} avg · ${formatActivityCount(point.rawValue)} actual`,
            }])}
            ticks={metric.unit === "percentage" ? [
                { id: "zero", value: 0, label: "0%" },
                { id: "maximum", value: 100, label: "100%" },
                ...(metric.currentValue === null ? [] : [{ id: "average", value: metric.currentValue, label: metricValue(metric, metric.currentValue), emphasized: true }]),
            ] : []}
            emptyLabel="No completed requests in this period"

            domainEnd={metric.points.length - 1}
            min={0}
            max={maximum}
            labels={labelIndexes.map((index, labelIndex) => ({ id: `${metric.key}-label-${index}`, position: index, label: metricTime(metric.points[index].startsAt, false, range), anchor: labelIndex === 0 ? "start" as const : labelIndex === labelIndexes.length - 1 ? "end" as const : "middle" as const }))}
            tone={metric.tone}
        /></div>
    </article>
}

export function ActivityTrends({ metrics, initialRange }: { metrics: AdminActivityMetricBundle; initialRange: AdminActivityRange }) {
    const [range, setRange] = useState(initialRange)
    return <div data-workspace-mutation-scope="local">
        <FilterRail ariaLabel="Activity time range">
            {(Object.keys(ACTIVITY_RANGES) as AdminActivityRange[]).map((item) => <FilterRailButton key={item} selected={range === item} onClick={() => setRange(item)}>{ACTIVITY_RANGES[item].label}</FilterRailButton>)}
        </FilterRail>
        <section className="mt-5" aria-label="Activity trends">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{metrics[range].map((metric) => <ActivityMetricCard key={metric.key} metric={metric} range={range} />)}</div>
            <p className="mt-2 min-h-10 text-[11px] text-neutral-500">Volume: {ACTIVITY_RANGES[range].smoothing} moving average per {ACTIVITY_RANGES[range].bucketLabel} bucket. Error rate: {ACTIVITY_RANGES[range].errorWindow} rolling average; dashed line shows the selected period average. Gaps mean no completed requests. Reload the tab for fresh data.</p>
        </section>
    </div>
}

export function ActivityTrendsLoading() {
    return <section className="mt-5" aria-label="Loading activity trends" aria-busy="true">
        <div className="h-12 rounded border border-neutral-800 motion-safe:animate-pulse" />
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((index) => <div key={index} className="aspect-[1.6/1] rounded-xl border border-neutral-800 bg-neutral-900 motion-safe:animate-pulse" />)}</div>
    </section>
}
