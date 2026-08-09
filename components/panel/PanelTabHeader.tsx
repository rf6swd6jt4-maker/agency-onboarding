import type { ReactNode } from "react"

export function PanelTabHeader({ title, description, actions, tabs }: { title: string; description: string; actions?: ReactNode; tabs?: ReactNode }) {
    return <section>
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div className="min-w-0">
                <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">{description}</p>
            </div>
            {actions ? <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">{actions}</div> : null}
        </header>
        {tabs}
    </section>
}
