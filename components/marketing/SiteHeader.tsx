"use client"

import { useState } from "react"
import Link from "next/link"
import { BrandLockup } from "@/components/brand/BrandLockup"

export function SiteHeader() {
    const [open, setOpen] = useState(false)
    return <header className="sticky top-0 z-40 border-b border-neutral-800/80 bg-neutral-950/90 backdrop-blur"><div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6"><BrandLockup href="/" /><div className="relative"><button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls="site-menu" aria-label="Open site menu" className="inline-flex h-10 w-10 flex-col items-center justify-center gap-1.5 rounded-lg border border-neutral-700 text-white hover:border-neutral-400"><span className="h-0.5 w-5 bg-current" /><span className="h-0.5 w-5 bg-current" /></button>{open && <nav id="site-menu" className="betelgeze-popup-enter absolute right-0 top-12 w-44 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 p-1 shadow-2xl"><Link href="/login" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800">Log in</Link><Link href="/sign-up" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800">Create account</Link></nav>}</div></div></header>
}
