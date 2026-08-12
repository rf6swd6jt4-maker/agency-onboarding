"use client"

import { useEffect, useState, type ReactNode } from "react"
import { BackToBetelgeze } from "@/components/onboarding-builder/OnboardingBuilderWindowControls"

export function DesktopBuilderGate({ workspaceSlug, backHref, children }: { workspaceSlug: string; backHref: string; children: ReactNode }) {
    const [desktop, setDesktop] = useState<boolean | null>(null)

    useEffect(() => {
        const query = window.matchMedia("(min-width: 768px)")
        const update = () => setDesktop(query.matches)
        update()
        query.addEventListener("change", update)
        return () => query.removeEventListener("change", update)
    }, [])

    if (desktop === null) return <main className="min-h-dvh bg-neutral-950" />
    if (desktop) return children

    return <main className="flex min-h-dvh items-center justify-center bg-neutral-950 p-6 text-white">
        <section className="w-full max-w-md rounded-2xl border border-neutral-800 bg-black p-7 text-center shadow-2xl shadow-black/30">
            <div className="mx-auto flex size-11 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-900 text-lg" aria-hidden="true">▰</div>
            <h1 className="mt-5 text-lg font-semibold">Onboarding Builder requires desktop</h1>
            <p className="mt-2 text-sm leading-6 text-neutral-400">This is a rich authoring workspace designed for a desktop-sized screen. Mobile Builder support will come later.</p>
            <BackToBetelgeze workspaceSlug={workspaceSlug} href={backHref} className="mt-6 inline-flex min-h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-medium text-black transition hover:bg-neutral-200" />
        </section>
    </main>
}
