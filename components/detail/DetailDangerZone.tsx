import type { ButtonHTMLAttributes, ReactNode } from "react"

export function DetailDangerZone({ children }: { children: ReactNode }) {
    return <section className="mt-10 border-t border-red-950/70 pt-5">
        <h2 className="text-sm font-semibold text-red-300">Danger zone</h2>
        <div className="mt-3 divide-y divide-neutral-900 border-y border-neutral-900">{children}</div>
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
        ? "bg-red-600 text-white hover:bg-red-500"
        : "border border-red-900/80 text-red-300 hover:bg-red-950/40"
    return <button {...props} className={`inline-flex min-h-9 items-center justify-center rounded-lg px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-35 ${toneClass} ${className}`} />
}
