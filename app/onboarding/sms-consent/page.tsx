import type { Metadata } from "next"
import Link from "next/link"
import { headers } from "next/headers"

import { SmsConsentForm } from "@/components/onboarding/SmsConsentForm"
import { getSmsConsentPage } from "@/lib/client-sales/sms-consent"
import { submitSmsConsent } from "./actions"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
    title: "SMS consent | Betelgeze",
    description: "Opt in to service-related client onboarding SMS messages.",
    robots: { index: false, follow: false },
}

type PageProps = {
    searchParams: Promise<{ token?: string }>
}

function unavailablePage() {
    return (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
            Use the secure SMS consent link provided by your agency. If the link has expired, ask the agency to send you a new one.
        </div>
    )
}

export default async function SmsConsentPage({ searchParams }: PageProps) {
    const { token = "" } = await searchParams
    const requestHeaders = await headers()
    const expectedWorkspaceSlug = requestHeaders.get("x-betelgeze-workspace-slug")
    const consent = await getSmsConsentPage(token, expectedWorkspaceSlug)
    const workspaceName = consent?.workspaceName ?? "your agency"
    const formAction = submitSmsConsent.bind(null, token)

    return (
        <main className="min-h-screen bg-[#F8F7F3] px-5 py-8 text-slate-900 sm:px-6 sm:py-12">
            <article className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-9">
                <p className="text-sm font-semibold text-[#1E3A5F]">{consent?.workspaceName ?? "Betelgeze"}</p>
                <h1 className="mt-5 text-3xl font-semibold tracking-tight">SMS consent</h1>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                    Opt in to receive service-related text messages from {workspaceName} about your client onboarding. After opting in, we will text you and ask you to reply <strong className="font-semibold text-slate-900">CONFIRM</strong> before sending your secure onboarding link.
                </p>

                <div className="mt-6">
                    {!consent || consent.state === "unavailable" ? unavailablePage()
                        : consent.state === "confirmed" ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950">Your SMS number is confirmed. Your secure onboarding link has been sent.</div>
                            : consent.state === "awaiting_confirmation" || consent.state === "sending" ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">Your opt-in was recorded. Check your phone and reply <strong>CONFIRM</strong> to receive your secure onboarding link.</div>
                                : consent.state === "opted_out" ? <div className="rounded-xl border border-slate-300 bg-slate-50 p-4 text-sm leading-6 text-slate-700">This number is opted out. Reply START to the agency&apos;s SMS number before using this page again.</div>
                                    : <SmsConsentForm action={formAction} workspaceName={consent.workspaceName} phoneHint={consent.phoneHint} />}
                </div>

                <p className="mt-6 text-xs leading-5 text-slate-500">
                    SMS consent is optional and is not a condition of purchase. See the{" "}
                    <Link href="https://www.betelgeze.com/terms" className="font-medium text-[#1E3A5F] underline underline-offset-2">Terms and Conditions</Link>
                    {" "}and{" "}
                    <Link href="https://www.betelgeze.com/privacy" className="font-medium text-[#1E3A5F] underline underline-offset-2">Privacy Policy</Link>.
                </p>
            </article>
        </main>
    )
}
