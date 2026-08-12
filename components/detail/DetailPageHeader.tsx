import type { ReactNode } from "react"

export type DetailHeaderFact = {
    label: string
    value: ReactNode
}

export type DetailHeaderFacts =
    | readonly []
    | readonly [DetailHeaderFact]
    | readonly [DetailHeaderFact, DetailHeaderFact]

export function DetailPageHeader({
    category,
    reference,
    title,
    subtitle,
    labels,
    facts = [],
    updated,
}: {
    category: string
    reference: string
    title: ReactNode
    subtitle?: ReactNode
    labels?: ReactNode
    facts?: DetailHeaderFacts
    updated: string
}) {
    return <header className="border-b border-neutral-800 pb-4">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
                <p className="truncate font-mono text-xs text-neutral-600">{category} {reference}</p>
                <h1 className="mt-1 break-words text-2xl font-semibold tracking-tight text-white sm:truncate">{title}</h1>
                {subtitle ? <div className="mt-1 min-w-0 truncate text-sm text-neutral-500">{subtitle}</div> : null}
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-xs text-neutral-500 sm:shrink-0 sm:justify-end">
                {labels}
                {facts.map((fact) => <span key={fact.label} className="shrink-0 whitespace-nowrap"><strong className="mr-1 font-semibold text-neutral-200">{fact.value}</strong> {fact.label}</span>)}
                <span className="shrink-0 whitespace-nowrap">Updated {updated}</span>
            </div>
        </div>
    </header>
}
