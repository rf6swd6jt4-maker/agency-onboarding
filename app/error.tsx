"use client"

import { ErrorBoundaryReporter } from "@/components/errors/ErrorBoundaryReporter"

type AppError = Error & { digest?: string }

export default function ErrorPage({ error, reset }: { error: AppError; reset: () => void }) {
    const code = `BGE-${error.digest ?? "UNEXPECTED"}`
    return <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white"><ErrorBoundaryReporter error={error} boundary="app" /><section className="w-full max-w-lg rounded-2xl border border-neutral-800 bg-neutral-900 p-8"><p className="text-xs font-semibold tracking-[0.18em] text-emerald-300">BETELGEZE</p><h1 className="mt-4 text-3xl font-semibold">We couldn’t load that just now</h1><p className="mt-3 text-sm leading-6 text-neutral-300">Your session has been kept. Check your connection and try again—there is no need to sign in again.</p><button type="button" onClick={reset} className="mt-6 rounded-lg bg-white px-4 py-3 text-sm font-medium text-black">Try again</button><code className="mt-6 block w-fit max-w-full overflow-auto rounded-lg bg-neutral-950 px-3 py-2 text-sm text-emerald-200">{code}</code></section></main>
}
