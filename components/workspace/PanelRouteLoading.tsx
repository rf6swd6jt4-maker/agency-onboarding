import { List, ListItem, ListPrimaryRow, ListSecondaryRow } from "@/components/list/List"

type Props = {
    title: string
    variant?: "list" | "detail" | "settings"
}

function Pulse({ className }: { className: string }) {
    return <span aria-hidden="true" className={`block animate-pulse rounded bg-neutral-800 ${className}`} />
}

function LoadingRows() {
    return <List ariaLabel="Loading content">
        {Array.from({ length: 5 }, (_, index) => <ListItem key={index}>
            <ListPrimaryRow><Pulse className="h-5 w-48 max-w-[55vw]" /><Pulse className="ml-auto h-5 w-20" /></ListPrimaryRow>
            <ListSecondaryRow><Pulse className="h-4 w-28" /><Pulse className="hidden h-4 w-40 sm:block" /><Pulse className="ml-auto h-4 w-20" /></ListSecondaryRow>
        </ListItem>)}
    </List>
}

export function PanelRouteLoading({ title, variant = "list" }: Props) {
    if (variant === "detail") {
        return <main aria-label={`Loading ${title}`} aria-busy="true" className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6">
            <div className="mx-auto max-w-[92rem]">
                <header className="border-b border-neutral-800 pb-4"><Pulse className="h-3 w-28" /><Pulse className="mt-2 h-7 w-64 max-w-[70vw]" /><Pulse className="mt-2 h-4 w-40" /></header>
                <div className="mt-5 min-h-80 animate-pulse rounded-2xl border border-neutral-800 bg-black" />
            </div>
        </main>
    }

    if (variant === "settings") {
        return <main aria-label={`Loading ${title}`} aria-busy="true" className="min-h-screen bg-neutral-950 px-4 pb-8 text-white sm:px-6">
            <div className="mx-auto max-w-7xl pt-5">
                <div className="mb-16 h-48 animate-pulse rounded-2xl border border-neutral-800 bg-neutral-900 sm:h-64" />
                <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
                <div className="mt-8 grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)]"><div className="hidden h-72 animate-pulse rounded-xl bg-neutral-900 lg:block" /><div className="space-y-10"><Pulse className="h-40 w-full" /><Pulse className="h-64 w-full" /></div></div>
            </div>
        </main>
    }

    return <main aria-label={`Loading ${title}`} aria-busy="true" className="min-h-screen bg-neutral-950 px-4 pb-7 text-white sm:px-6">
        <div className="mx-auto max-w-7xl pt-5">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <Pulse className="mt-2 h-4 w-[32rem] max-w-full" />
            <div className="mt-5 h-12 animate-pulse rounded-xl border border-neutral-800 bg-neutral-900" />
            <div className="mt-5 h-10 animate-pulse border-y border-neutral-800 bg-neutral-900/30" />
            <LoadingRows />
        </div>
    </main>
}
