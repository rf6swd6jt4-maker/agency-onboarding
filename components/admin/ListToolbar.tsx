"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useId, useRef, useState } from "react"
import { Avatar } from "@/components/account/Avatar"

type Option = { value: string; label: string; avatarSrc?: string | null }

export function ListToolbar({
    sortOptions,
    filterGroups,
}: {
    sortOptions: Option[]
    filterGroups: Array<{ label: string; options: Option[] }>
}) {
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const sort = searchParams.get("sort") ?? sortOptions[0]?.value ?? ""
    const filter = searchParams.get("filter") ?? "all"
    const [filterOpen, setFilterOpen] = useState(false)
    const filterId = useId()
    const filterRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        function close(event: MouseEvent) {
            if (filterRef.current && !filterRef.current.contains(event.target as Node)) setFilterOpen(false)
        }
        function escape(event: KeyboardEvent) {
            if (event.key === "Escape") setFilterOpen(false)
        }
        function closeForOtherDropdown(event: Event) {
            if ((event as CustomEvent<string>).detail !== filterId) setFilterOpen(false)
        }
        document.addEventListener("mousedown", close)
        document.addEventListener("keydown", escape)
        window.addEventListener("betelgeze:dropdown-open", closeForOtherDropdown)
        return () => {
            document.removeEventListener("mousedown", close)
            document.removeEventListener("keydown", escape)
            window.removeEventListener("betelgeze:dropdown-open", closeForOtherDropdown)
        }
    }, [filterId])

    function setOption(key: "sort" | "filter", value: string) {
        const next = new URLSearchParams(searchParams.toString())
        if (!value || (key === "filter" && value === "all")) next.delete(key)
        else next.set(key, value)
        router.replace(`${pathname}${next.size ? `?${next.toString()}` : ""}`)
        if (key === "filter") setFilterOpen(false)
    }

    function toggleFilter() {
        setFilterOpen((value) => {
            const next = !value
            if (next) window.dispatchEvent(new CustomEvent("betelgeze:dropdown-open", { detail: filterId }))
            return next
        })
    }

    return <div className="mt-5 flex flex-wrap items-center gap-2 overflow-visible rounded-xl border border-neutral-800 bg-neutral-900/70 p-3"><label className="flex min-h-10 min-w-0 items-center gap-2 text-sm text-neutral-400">Sort <select value={sort} onChange={(event) => setOption("sort", event.target.value)} className="min-w-0 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-sm text-white">{sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><div ref={filterRef} className="relative z-50"><button type="button" onClick={toggleFilter} aria-expanded={filterOpen} aria-haspopup="menu" className="flex min-h-10 cursor-pointer list-none items-center rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-200 hover:border-neutral-500">Filter by{filter !== "all" && <span className="ml-2 h-2 w-2 rotate-45 bg-amber-300" />}</button>{filterOpen && <div role="menu" className="betelgeze-popup-enter absolute right-0 z-[9999] mt-2 max-h-[70vh] w-[min(19rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-neutral-700 bg-neutral-900 p-2 shadow-2xl sm:left-0 sm:right-auto"><button type="button" onClick={() => setOption("filter", "all")} className={`w-full rounded-lg px-2.5 py-2 text-left text-sm ${filter === "all" ? "bg-white text-black" : "text-neutral-200 hover:bg-neutral-800"}`}>All entries</button>{filterGroups.map((group) => <div key={group.label} className="mt-2 border-t border-neutral-800 pt-2"><p className="px-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500">{group.label}</p>{group.options.map((option) => <button key={option.value} type="button" onClick={() => setOption("filter", option.value)} className={`mt-1 flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm ${filter === option.value ? "bg-white text-black" : "text-neutral-200 hover:bg-neutral-800"}`}>{option.avatarSrc !== undefined && <Avatar src={option.avatarSrc} name={option.label} className="h-6 w-6 shrink-0" />}{option.label}</button>)}</div>)}</div>}</div>{filter !== "all" && <button type="button" onClick={() => setOption("filter", "all")} className="min-h-10 px-2 text-sm text-neutral-400 underline underline-offset-4 hover:text-white">Clear</button>}</div>
}
