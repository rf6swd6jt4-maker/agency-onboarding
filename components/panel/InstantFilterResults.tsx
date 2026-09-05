"use client"

import { Fragment, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"

export type InstantFilterDefinition = {
    param: string
    defaultValue?: string | null
}

export type InstantFilterValueItem = {
    id: string
    values: Record<string, string | string[]>
}

export type InstantFilterResult = InstantFilterValueItem & {
    content: ReactNode
}

type SearchParamsReader = { get(name: string): string | null }

function selectedValue(searchParams: SearchParamsReader, filter: InstantFilterDefinition) {
    return searchParams.get(filter.param) ?? filter.defaultValue ?? null
}

function itemMatches(searchParams: SearchParamsReader, filters: InstantFilterDefinition[], item: InstantFilterValueItem, override?: { param: string; value: string | null }) {
    return filters.every((filter) => {
        const selected = override?.param === filter.param ? override.value : selectedValue(searchParams, filter)
        if (!selected) return true
        const values = item.values[filter.param]
        return Array.isArray(values) ? values.includes(selected) : values === selected
    })
}

export function InstantFilterResults({ filters, items, empty }: {
    filters: InstantFilterDefinition[]
    items: InstantFilterResult[]
    empty: ReactNode
}) {
    const searchParams = useSearchParams()
    const visibleItems = items.filter((item) => itemMatches(searchParams, filters, item))

    if (!visibleItems.length) return empty
    return visibleItems.map((item) => <Fragment key={item.id}>{item.content}</Fragment>)
}

export function InstantFilterCount({ filters, items, target }: {
    filters: InstantFilterDefinition[]
    items: InstantFilterValueItem[]
    target: { param: string; value: string | null }
}) {
    const searchParams = useSearchParams()
    return items.filter((item) => itemMatches(searchParams, filters, item, target)).length
}
