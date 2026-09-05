import type { ReactNode } from "react"

function LoadingMark() {
    return <span aria-hidden="true" className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border border-neutral-700 border-t-neutral-300" />
}

export function DetailLoadingLabel({ children }: { children: ReactNode }) {
    return <span role="status" className="inline-flex items-center gap-2 text-xs text-neutral-500">
        <LoadingMark />
        <span>{children}</span>
    </span>
}

export function DetailFieldsLoading({ label = "Loading details", rows = 4 }: { label?: string; rows?: number }) {
    return <section aria-label={label} aria-busy="true" className="mt-5">
        <div className="pb-2">
            <DetailLoadingLabel>{label}</DetailLoadingLabel>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2">
            {Array.from({ length: rows }, (_, index) => (
                <div key={index} aria-hidden="true" className={`${index % 2 === 1 ? "lg:border-l lg:border-neutral-900 lg:pl-8" : ""} grid min-h-10 grid-cols-[8rem_minmax(0,1fr)] items-center gap-2 border-b border-neutral-900 py-2 sm:grid-cols-[9rem_minmax(0,1fr)]`}>
                    <span className="h-3 w-20 rounded bg-neutral-900" />
                    <span className={`h-3 rounded bg-neutral-900 ${index % 3 === 0 ? "w-24" : index % 3 === 1 ? "w-32" : "w-20"}`} />
                </div>
            ))}
        </div>
    </section>
}

export function DetailContentLoading({ label, className = "" }: { label: string; className?: string }) {
    return <section aria-label={label} aria-busy="true" className={`mt-6 min-h-40 rounded-xl border border-neutral-800 bg-black px-5 py-4 ${className}`}>
        <DetailLoadingLabel>{label}</DetailLoadingLabel>
    </section>
}
