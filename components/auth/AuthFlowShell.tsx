import Link from "next/link"
import type { ReactNode } from "react"
import { BrandLockup } from "@/components/brand/BrandLockup"
import { AUTH_STEPS, type AuthStep } from "@/lib/auth/account-flow-types"

const GUIDED_STEPS = AUTH_STEPS.filter((step) => !["review", "complete"].includes(step))

export function AuthFlowShell({
    step,
    eyebrow,
    title,
    description,
    children,
    footer,
    showProgress = true,
}: {
    step?: AuthStep
    eyebrow?: string
    title: string
    description?: string
    children: ReactNode
    footer?: ReactNode
    showProgress?: boolean
}) {
    const progressIndex = step ? GUIDED_STEPS.indexOf(step) : -1
    const progress = progressIndex >= 0 ? ((progressIndex + 1) / GUIDED_STEPS.length) * 100 : 0
    return (
        <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-neutral-950 px-5 py-10 text-white sm:px-6">
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.11),transparent_68%)]" />
            <section className="relative w-full max-w-md overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/95 shadow-2xl shadow-black/40">
                {showProgress && progressIndex >= 0 ? (
                    <div className="h-1 bg-neutral-800" role="progressbar" aria-valuemin={1} aria-valuemax={GUIDED_STEPS.length} aria-valuenow={progressIndex + 1} aria-label={`Account setup step ${progressIndex + 1} of ${GUIDED_STEPS.length}`}>
                        <div className="h-full bg-emerald-300 transition-[width] duration-300" style={{ width: `${progress}%` }} />
                    </div>
                ) : null}
                <div className="p-6 sm:p-8">
                    <BrandLockup compact />
                    {eyebrow ? <p className="mt-6 text-sm text-neutral-400">{eyebrow}</p> : null}
                    <h1 className={`${eyebrow ? "mt-2" : "mt-6"} text-2xl font-semibold tracking-tight sm:text-[1.75rem]`}>{title}</h1>
                    {description ? <p className="mt-3 text-sm leading-6 text-neutral-300">{description}</p> : null}
                    <div className="mt-6">{children}</div>
                    {footer ? <div className="mt-6 border-t border-neutral-800 pt-5 text-sm text-neutral-400">{footer}</div> : null}
                </div>
            </section>
        </main>
    )
}

export function AuthBackToLogin({ href = "/login" }: { href?: string }) {
    return <Link href={href} className="text-neutral-200 underline decoration-neutral-600 underline-offset-4 hover:decoration-neutral-300">Back to login</Link>
}

export const authPrimaryButton = "inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-45"
export const authSecondaryButton = "inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-neutral-700 px-4 py-3 text-sm font-medium text-white transition hover:border-neutral-500 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-45"
export const authInput = "mt-2 min-h-11 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-base text-white outline-none transition placeholder:text-neutral-600 focus:border-neutral-400 focus:ring-2 focus:ring-white/10 disabled:cursor-not-allowed disabled:opacity-60"
