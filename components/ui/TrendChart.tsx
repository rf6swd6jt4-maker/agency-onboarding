"use client"

import { useId, useState } from "react"

export type TrendChartPoint = {
    id: string
    position: number
    value: number
    ariaLabel: string
    tooltipLabel: string
    tooltipValue: string
    unchanged?: boolean
}

export type TrendChartTick = {
    id: string
    value: number
    label: string
    emphasized?: boolean
}

export type TrendChartBand = {
    id: string
    start: number
    end: number
    tone: "red"
}

export type TrendChartLabel = {
    id: string
    position: number
    label: string
    anchor: "start" | "middle" | "end"
}

type Props = {
    ariaLabel: string
    points: TrendChartPoint[]
    startPoint?: { position: number; value: number }
    domainEnd: number
    min: number
    max: number
    ticks?: TrendChartTick[]
    bands?: TrendChartBand[]
    labels?: TrendChartLabel[]
    emptyLabel?: string
    reveal?: boolean
    tone?: "neutral" | "red"
}

export function TrendChart({
    ariaLabel,
    points,
    startPoint,
    domainEnd,
    min,
    max,
    ticks = [],
    bands = [],
    labels = [],
    emptyLabel = "No data in this period",
    tone = "neutral",
    reveal = false,
}: Props) {
    const [activeId, setActiveId] = useState<string | null>(null)
    const instanceId = useId().replace(/:/g, "")
    const gradientId = `trend-fill-${instanceId}`
    const chartWidth = 560
    const plotLeft = 8
    const plotRight = 490
    const plotTop = 16
    const plotBottom = 198
    const safeDomainEnd = Math.max(1, domainEnd)
    const valueSpan = Math.max(Number.EPSILON, max - min)
    const x = (position: number) => plotLeft + Math.min(Math.max(0, position), safeDomainEnd) * ((plotRight - plotLeft) / safeDomainEnd)
    const y = (value: number) => plotBottom - ((value - min) / valueSpan) * (plotBottom - plotTop)
    const series = startPoint ? [startPoint, ...points] : points
    const activePoint = activeId === null ? null : points.find((point) => point.id === activeId) ?? null
    const tooltipX = activePoint ? Math.max(plotLeft, Math.min(plotRight - 168, x(activePoint.position) - 84)) : 0
    const tooltipY = activePoint ? Math.max(plotTop, y(activePoint.value) - 52) : 0
    const lineColour = tone === "red" ? "rgb(248 113 113)" : "white"

    return <div className="min-w-0">
        <svg viewBox={`0 0 ${chartWidth} 232`} className="aspect-[2.4/1] w-full overflow-visible" role="img" aria-label={ariaLabel} onPointerLeave={() => setActiveId(null)}>
            <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={lineColour} stopOpacity="0.2" /><stop offset="100%" stopColor={lineColour} stopOpacity="0" /></linearGradient></defs>
            {ticks.map((tick) => <g key={tick.id}><line x1={plotLeft} x2={plotRight} y1={y(tick.value)} y2={y(tick.value)} stroke={tick.emphasized ? "rgb(82 82 82)" : "rgb(38 38 38)"} strokeWidth="1" strokeDasharray={tick.emphasized ? "4 5" : undefined} /><line x1={plotRight} x2={plotRight + 5} y1={y(tick.value)} y2={y(tick.value)} stroke="rgb(82 82 82)" /><text x={plotRight + 10} y={y(tick.value) + 4} fill={tick.emphasized ? "rgb(212 212 212)" : "rgb(115 115 115)"} className="text-[12px] sm:text-[9px]">{tick.label}</text></g>)}
            <line x1={plotRight} x2={plotRight} y1={plotTop} y2={plotBottom} stroke="rgb(38 38 38)" />
            {bands.map((band) => <rect key={band.id} x={x(band.start)} y={plotTop} width={Math.max(3, x(band.end) - x(band.start))} height={plotBottom - plotTop} fill={band.tone === "red" ? "rgb(127 29 29)" : undefined} opacity="0.1" />)}
            {points.length ? <g className={reveal ? "trend-chart-reveal" : undefined}><polygon points={`${x(series[0].position)},${plotBottom} ${series.map((point) => `${x(point.position)},${y(point.value)}`).join(" ")} ${x(series.at(-1)!.position)},${plotBottom}`} fill={`url(#${gradientId})`} /><polyline points={series.map((point) => `${x(point.position)},${y(point.value)}`).join(" ")} fill="none" stroke={lineColour} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></g> : null}
            {points.filter((point) => point.unchanged).map((point) => <line key={`same-${point.id}`} x1={x(point.position) - 4} x2={x(point.position) + 4} y1={y(point.value)} y2={y(point.value)} stroke="rgb(163 163 163)" strokeWidth="4" strokeLinecap="round" />)}
            {points.map((point) => <rect key={`hit-${point.id}`} x={x(point.position) - 5} y={plotTop} width="10" height={plotBottom - plotTop} fill="transparent" tabIndex={0} className="outline-none" aria-label={point.ariaLabel} onPointerEnter={() => setActiveId(point.id)} onPointerDown={() => setActiveId(point.id)} onFocus={() => setActiveId(point.id)} onBlur={() => setActiveId(null)} />)}
            {activePoint ? <g pointerEvents="none"><circle cx={x(activePoint.position)} cy={y(activePoint.value)} r="4" fill={lineColour} stroke="black" strokeWidth="2" /><rect x={tooltipX} y={tooltipY} width="168" height="44" rx="7" fill="rgb(23 23 23)" stroke="rgb(82 82 82)" /><text x={tooltipX + 9} y={tooltipY + 17} fill="rgb(163 163 163)" className="text-[12px] sm:text-[9px]">{activePoint.tooltipLabel}</text><text x={tooltipX + 9} y={tooltipY + 35} fill={lineColour} fontWeight="600" className="text-[14px] sm:text-[10px]">{activePoint.tooltipValue}</text></g> : null}
            {!points.length ? <text x={(plotLeft + plotRight) / 2} y="76" textAnchor="middle" fill="rgb(64 64 64)" fontSize="11">{emptyLabel}</text> : null}
            {labels.map((label) => <text key={label.id} x={x(label.position)} y="222" textAnchor={label.anchor} fill="rgb(82 82 82)" className="text-[12px] sm:text-[9px]">{label.label}</text>)}
        </svg>
    </div>
}
