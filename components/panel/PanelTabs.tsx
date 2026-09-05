"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { WORKSPACE_TAB_FRAME_PARAM, workspaceTabFrameUrl } from "@/lib/workspace-tabs"

export type PanelTab = {
    key: string
    label: string
    href: string
}

export function PanelTabs({ items, active, ariaLabel }: { items: readonly PanelTab[]; active: string; ariaLabel: string }) {
    const router = useRouter()
    const searchParams = useSearchParams()
    const tabId = searchParams.get(WORKSPACE_TAB_FRAME_PARAM)
    const [optimisticSelection, setOptimisticSelection] = useState<{ base: string; value: string } | null>(null)
    const optimisticActive = optimisticSelection?.base === active ? optimisticSelection.value : active
    const framedItems = useMemo(() => items.map((item) => ({
        ...item,
        navigationHref: tabId ? workspaceTabFrameUrl(item.href, tabId, "http://localhost") : item.href,
    })), [items, tabId])

    useEffect(() => {
        if (!tabId) return
        const activeIndex = framedItems.findIndex((item) => item.key === active)
        const likelyItems = [framedItems[activeIndex + 1], framedItems[activeIndex - 1]].filter((item): item is (typeof framedItems)[number] => Boolean(item))
        const warm = () => likelyItems.forEach((item) => router.prefetch(item.navigationHref))
        const requestIdle = window.requestIdleCallback
        if (typeof requestIdle === "function") {
            const idleId = requestIdle(warm, { timeout: 800 })
            return () => window.cancelIdleCallback(idleId)
        }
        const timeout = window.setTimeout(warm, 120)
        return () => window.clearTimeout(timeout)
    }, [active, framedItems, router, tabId])

    return <nav aria-label={ariaLabel} className="mt-5 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 text-sm sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        {framedItems.map((item) => <Link
            key={item.key}
            href={item.navigationHref}
            aria-current={optimisticActive === item.key ? "page" : undefined}
            onPointerEnter={() => { if (tabId) router.prefetch(item.navigationHref) }}
            onFocus={() => { if (tabId) router.prefetch(item.navigationHref) }}
            onClick={() => setOptimisticSelection({ base: active, value: item.key })}
            className={`shrink-0 rounded-lg px-3 py-2.5 sm:py-2 ${optimisticActive === item.key ? "bg-white font-medium text-black" : "border border-neutral-800 text-neutral-300 hover:border-neutral-600 hover:text-white"}`}
        >
            {item.label}
        </Link>)}
    </nav>
}
