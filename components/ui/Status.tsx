import { BetelgezeStatusMark } from "@/components/brand/BetelgezeStatusMark"
import { statusToneClasses, type StatusTone } from "./status-styles"

export function Status({ label, tone = "grey", compact = false, wrap = false, className = "" }: { label: string; tone?: StatusTone; compact?: boolean; wrap?: boolean; className?: string }) {
    const classes = statusToneClasses[tone]
    return (
        <span aria-label={compact ? label : undefined} title={compact ? label : undefined} className={`inline-flex ${wrap ? "min-w-0 items-start whitespace-normal" : "items-center whitespace-nowrap"} ${compact ? "gap-0" : "gap-2 text-sm"} ${classes.text} ${className}`}>
            <BetelgezeStatusMark className={`${classes.mark} ${wrap ? "mt-1 shrink-0" : ""}`} />
            {compact ? null : <span className={wrap ? "min-w-0 break-words" : undefined}>{label}</span>}
        </span>
    )
}
