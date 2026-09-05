import type { CSSProperties, ReactNode } from "react"

import { List, ListItem, ListPrimaryRow, ListSecondaryRow } from "@/components/list/List"
import { DetailRouteLoading } from "@/components/workspace/DetailRouteLoading"

export type PanelLoadingVariant =
    | "admin"
    | "admin-activity"
    | "admin-maintenance"
    | "appointment-setting"
    | "assets"
    | "communications"
    | "fulfilment"
    | "leadgen"
    | "leadgen-polls"
    | "onboarding"
    | "relationships"
    | "settings"
    | "work-items"
    | "detail"

function Pulse({ className, style }: { className: string; style?: CSSProperties }) {
    return <span aria-hidden="true" className={`block animate-pulse rounded bg-neutral-800 ${className}`} style={style} />
}

function PanelFrame({ title, children }: { title: string; children: ReactNode }) {
    return <main aria-label={`Loading ${title}`} aria-busy="true" className="min-h-screen bg-neutral-950 px-4 pb-8 text-white sm:px-6">
        <div className="mx-auto max-w-7xl">{children}</div>
    </main>
}

function PanelHeader({ title, action = false, tabs = [] }: { title: string; action?: boolean; tabs?: string[] }) {
    return <section>
        <header className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div className="min-w-0">
                <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
                <Pulse className="mt-2 h-4 w-[34rem] max-w-full" />
            </div>
            {action ? <Pulse className="h-11 w-full sm:h-10 sm:w-32" /> : null}
        </header>
        {tabs.length ? <nav aria-label={`Loading ${title} tabs`} className="mt-5 flex gap-2 overflow-hidden">
            {tabs.map((tab, index) => <span key={tab} className={`shrink-0 rounded-lg px-3 py-2 text-sm ${index === 0 ? "bg-white text-black" : "border border-neutral-800 text-neutral-500"}`}>{tab}</span>)}
        </nav> : null}
    </section>
}

function StatsSkeleton({ count = 4 }: { count?: number }) {
    return <section aria-label="Loading statistics" className="mt-5 grid grid-cols-3 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 sm:flex sm:gap-3 sm:overflow-visible sm:rounded-none sm:border-0 sm:bg-transparent">
        {Array.from({ length: count }, (_, index) => <div key={index} className={`${index >= 3 ? "hidden sm:block" : ""} min-w-0 border-r border-neutral-800 px-2 py-2 last:border-r-0 sm:flex-1 sm:rounded-lg sm:border sm:bg-neutral-900 sm:px-3`}>
            <Pulse className="h-3 w-16 max-w-full" />
            <Pulse className="mt-2 h-6 w-10" />
        </div>)}
    </section>
}

function FilterSkeleton({ widths }: { widths: number[] }) {
    return <section aria-label="Loading filters" className="mt-5 border-y border-neutral-800/80 py-1">
        <div className="flex gap-1 overflow-hidden px-1 pb-1">
            {widths.map((width, index) => <span key={index} className="shrink-0 px-2 py-2"><Pulse className="h-4" style={{ width }} /></span>)}
        </div>
    </section>
}

function RowSkeleton({ kind = "default" }: { kind?: "default" | "relationship" | "onboarding" }) {
    return <ListItem>
        <ListPrimaryRow>
            <Pulse className="h-5 w-48 max-w-[45vw]" />
            {kind === "relationship" ? <Pulse className="h-6 w-24 [clip-path:polygon(12px_0,calc(100%-12px)_0,100%_50%,calc(100%-12px)_100%,12px_100%,0_50%)]" /> : null}
            {kind === "onboarding" ? <Pulse className="hidden h-2 w-24 sm:block" /> : null}
            <Pulse className="ml-auto h-4 w-20" />
        </ListPrimaryRow>
        <ListSecondaryRow>
            <Pulse className="h-4 w-24" />
            <Pulse className="hidden h-4 w-36 sm:block" />
            {kind === "onboarding" ? <Pulse className="hidden h-4 w-28 md:block" /> : null}
            <Pulse className="ml-auto h-4 w-20" />
        </ListSecondaryRow>
    </ListItem>
}

function ListSkeleton({ kind = "default", rows = 5 }: { kind?: "default" | "relationship" | "onboarding"; rows?: number }) {
    return <List ariaLabel="Loading content">{Array.from({ length: rows }, (_, index) => <RowSkeleton key={index} kind={kind} />)}</List>
}

function RelationshipsLoading() {
    return <PanelFrame title="Relationships">
        <PanelHeader title="Relationships" action />
        <FilterSkeleton widths={[54, 70, 104, 64, 86, 78]} />
        <ListSkeleton kind="relationship" />
    </PanelFrame>
}

function OnboardingLoading() {
    return <PanelFrame title="Onboarding">
        <PanelHeader title="Onboarding" />
        <StatsSkeleton count={3} />
        <FilterSkeleton widths={[54, 70, 86, 64]} />
        <ListSkeleton kind="onboarding" />
    </PanelFrame>
}

function WorkItemsLoading({ fulfilment = false }: { fulfilment?: boolean }) {
    const title = fulfilment ? "Fulfilment" : "Work Items"
    return <PanelFrame title={title}>
        <PanelHeader title={title} action={!fulfilment} tabs={fulfilment ? [] : ["Work Items", "Assets"]} />
        <StatsSkeleton />
        <FilterSkeleton widths={fulfilment ? [70, 74, 86] : [54, 62, 74, 92]} />
        <ListSkeleton />
    </PanelFrame>
}

function AppointmentSettingLoading() {
    return <PanelFrame title="Appointment Setting">
        <PanelHeader title="Appointment Setting" />
        <ListSkeleton kind="relationship" rows={4} />
    </PanelFrame>
}

function AdminLoading({ section = "work" }: { section?: "work" | "activity" | "maintenance" }) {
    const title = section === "activity" ? "Activity Console" : section === "maintenance" ? "Maintenance Queue" : "Work Queue"
    return <PanelFrame title={title}>
        <PanelHeader title={title} tabs={["Work Queue", "OKRs", "Maintenance", "Activity"]} />
        {section === "activity" ? <section aria-label="Loading activity trends" className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="min-h-28 rounded-xl border border-neutral-800 bg-black p-4"><Pulse className="h-3 w-24" /><Pulse className="mt-3 h-7 w-16" /><Pulse className="mt-3 h-8 w-full bg-neutral-900" /></div>)}</section> : <StatsSkeleton />}
        <FilterSkeleton widths={section === "work" ? [82, 74] : section === "activity" ? [54, 62, 74, 58] : [58, 78]} />
        {section !== "work" ? <FilterSkeleton widths={section === "activity" ? [92, 82, 104, 76, 88] : [104, 82, 96, 74]} /> : null}
        <ListSkeleton />
    </PanelFrame>
}

function LeadgenLoading({ polls = false }: { polls?: boolean }) {
    const title = polls ? "Polls" : "Leads"
    return <PanelFrame title={title}>
        <PanelHeader title={title} action tabs={["Leads", "Polls", "Sources", "Settings"]} />
        <StatsSkeleton count={polls ? 4 : 3} />
        <ListSkeleton />
    </PanelFrame>
}

function AssetsLoading() {
    return <PanelFrame title="Assets">
        <PanelHeader title="Assets" action tabs={["Work Items", "Assets"]} />
        <StatsSkeleton />
        <section aria-label="Loading assets" className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {Array.from({ length: 10 }, (_, index) => <article key={index} className="overflow-hidden rounded-xl border border-neutral-800 bg-black">
                <Pulse className="aspect-[4/3] w-full rounded-none bg-neutral-900" />
                <div className="p-4"><Pulse className="h-5 w-4/5" /><Pulse className="mt-2 h-3 w-16" /><div className="mt-4 flex justify-between"><Pulse className="h-3 w-20" /><Pulse className="h-3 w-12" /></div></div>
            </article>)}
        </section>
    </PanelFrame>
}

function CommunicationsLoading() {
    return <main aria-label="Loading Communications" aria-busy="true" className="fixed inset-0 overflow-hidden bg-black text-white">
        <div className="grid h-full min-h-0 lg:grid-cols-[22rem_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col border-r border-neutral-800 bg-neutral-950">
                <div className="shrink-0 border-b border-neutral-800 p-3">
                    <div className="flex items-center gap-2"><span className="rounded-lg bg-neutral-800 px-3 py-2 text-xs font-semibold">Clients</span><span className="px-3 py-2 text-xs text-neutral-500">Team</span><Pulse className="ml-auto h-3 w-12" /></div>
                    <Pulse className="mt-3 h-10 w-full rounded-lg bg-black" />
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                    {Array.from({ length: 7 }, (_, index) => <div key={index} className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-3 border-b border-neutral-900 px-4 py-3.5">
                        <Pulse className="h-11 w-11 rounded-full" />
                        <div className="min-w-0"><Pulse className="h-4 w-2/3" /><Pulse className="mt-2 h-3 w-5/6 bg-neutral-900" /></div>
                    </div>)}
                </div>
            </aside>
            <section className="hidden min-h-0 flex-col lg:flex">
                <header className="flex h-[69px] shrink-0 items-center gap-3 border-b border-neutral-800 px-4"><Pulse className="h-10 w-10 rounded-full" /><div><Pulse className="h-4 w-36" /><Pulse className="mt-2 h-3 w-24 bg-neutral-900" /></div></header>
                <div className="flex min-h-0 flex-1 flex-col justify-end gap-4 overflow-hidden p-5">
                    <Pulse className="h-14 w-56 rounded-2xl bg-neutral-900" />
                    <Pulse className="ml-auto h-20 w-72 rounded-2xl bg-neutral-800" />
                    <Pulse className="h-16 w-64 rounded-2xl bg-neutral-900" />
                </div>
                <footer className="shrink-0 border-t border-neutral-800 bg-neutral-950 p-4"><Pulse className="mx-auto h-11 w-full max-w-3xl rounded-xl bg-black" /></footer>
            </section>
        </div>
    </main>
}

function SettingsLoading() {
    return <main aria-label="Loading Settings" aria-busy="true" className="min-h-screen max-w-full overflow-x-clip bg-neutral-950 px-4 pb-8 text-white sm:px-6">
        <div className="mx-auto max-w-7xl pt-5">
            <div className="relative mb-16 h-48 animate-pulse rounded-xl border border-neutral-800 bg-neutral-900 sm:h-64 sm:rounded-2xl"><div className="absolute bottom-0 left-4 h-[112px] w-[112px] translate-y-1/2 rounded-full border-4 border-neutral-950 bg-neutral-900 sm:left-7 sm:h-[108px] sm:w-[108px]" /></div>
            <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
            <div className="mt-8 grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)]">
                <nav aria-label="Loading settings sections" className="hidden space-y-3 lg:block">{Array.from({ length: 8 }, (_, index) => <Pulse key={index} className="h-10 w-full rounded-lg bg-neutral-900" />)}</nav>
                <div className="space-y-10">{[160, 240, 190].map((height, index) => <section key={index}><Pulse className="h-5 w-40" /><Pulse className="mt-2 h-4 w-72 max-w-full bg-neutral-900" /><div className="mt-4 animate-pulse rounded-2xl border border-neutral-800 bg-neutral-900/70" style={{ height }} /></section>)}</div>
            </div>
        </div>
    </main>
}

export function PanelRouteLoading({ variant, title }: { variant: PanelLoadingVariant; title?: string }) {
    if (variant === "communications") return <CommunicationsLoading />
    if (variant === "settings") return <SettingsLoading />
    if (variant === "relationships") return <RelationshipsLoading />
    if (variant === "onboarding") return <OnboardingLoading />
    if (variant === "work-items") return <WorkItemsLoading />
    if (variant === "fulfilment") return <WorkItemsLoading fulfilment />
    if (variant === "appointment-setting") return <AppointmentSettingLoading />
    if (variant === "assets") return <AssetsLoading />
    if (variant === "leadgen") return <LeadgenLoading />
    if (variant === "leadgen-polls") return <LeadgenLoading polls />
    if (variant === "admin-activity") return <AdminLoading section="activity" />
    if (variant === "admin-maintenance") return <AdminLoading section="maintenance" />
    if (variant === "admin") return <AdminLoading />
    return <DetailRouteLoading title={title ?? "record"} />
}
