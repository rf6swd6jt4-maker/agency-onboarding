import type { ButtonHTMLAttributes, ReactNode } from "react"

export function DetailDangerZone({ children }: { children: ReactNode }) {
    return <section className="mt-10 overflow-hidden rounded-xl border border-red-900/45 bg-red-950/10">
        <h2 className="px-4 pb-3 pt-4 text-sm font-semibold text-red-200/90">Danger zone</h2>
        <div className="divide-y divide-red-950/70 border-t border-red-950/70 px-4">{children}</div>
    </section>
}

export function DetailDangerAction({ title, description, control }: { title: string; description: ReactNode; control: ReactNode }) {
    return <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-3xl">
            <h3 className="text-sm font-medium text-neutral-200">{title}</h3>
            <div className="mt-1 text-xs leading-5 text-neutral-500">{description}</div>
        </div>
        <div className="shrink-0">{control}</div>
    </div>
}

export function DetailDangerButton({ tone = "archive", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "archive" | "delete" }) {
    const toneClass = tone === "delete"
        ? "border border-red-800/70 bg-red-900/30 text-red-100 hover:bg-red-900/45"
        : "border border-red-900/70 bg-red-950/15 text-red-200 hover:bg-red-950/35"
    return <button {...props} className={`inline-flex min-h-9 items-center justify-center rounded-lg px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-35 ${toneClass} ${className}`} />
}
