import type { Metadata } from "next"
import Link from "next/link"
import { headers } from "next/headers"

import { SmsOptInForm } from "@/components/onboarding/SmsOptInForm"
import { getPublicSmsOptInWorkspace } from "@/lib/client-sales/sms-consent"
import { submitPublicSmsOptIn } from "./actions"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
    title: "SMS opt-in | Betelgeze",
    description: "Choose whether to receive service-related SMS messages from your agency.",
}

export default async function SmsOptInPage() {
    const requestHeaders = await headers()
    const workspace = await getPublicSmsOptInWorkspace(requestHeaders.get("x-betelgeze-workspace-slug"))

    return (
        <main className="min-h-screen bg-[#F8F7F3] px-5 py-8 text-slate-900 sm:px-6 sm:py-12">
            <article className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-9">
                <p className="text-sm font-semibold text-[#1E3A5F]">{workspace?.name ?? "Betelgeze"}</p>
                <h1 className="mt-5 text-3xl font-semibold tracking-tight">SMS opt-in</h1>
                {workspace ? (
                    <>
                        <p className="mt-3 text-sm leading-6 text-slate-600">
                            Choose whether to receive text messages from <strong className="font-semibold text-slate-900">{workspace.name}</strong> about your client onboarding and services.
                        </p>
                        <section aria-labelledby="sms-program-details" className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
                            <h2 id="sms-program-details" className="text-sm font-semibold text-slate-950">What you are opting in to</h2>
                            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-700">
                                <li>Confirmation requests and secure onboarding or payment links.</li>
                                <li>Updates about your onboarding and services from {workspace.name}.</li>
                                <li>Message frequency varies. Message and data rates may apply.</li>
                                <li>Reply HELP for help or STOP to opt out at any time.</li>
                            </ul>
                        </section>
                        <SmsOptInForm action={submitPublicSmsOptIn} workspaceName={workspace.name} />
                    </>
                ) : (
                    <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                        Open the public SMS opt-in page on the agency website that directed you here.
                    </div>
                )}

                <p className="mt-6 text-xs leading-5 text-slate-500">
                    SMS consent is optional and is not a condition of purchase. You can continue working with the agency without opting in. See the{" "}
                    <Link href="https://www.betelgeze.com/terms" className="font-medium text-[#1E3A5F] underline underline-offset-2">SMS Terms and Conditions</Link>
                    {" "}and{" "}
                    <Link href="https://www.betelgeze.com/privacy" className="font-medium text-[#1E3A5F] underline underline-offset-2">Privacy Policy</Link>.
                </p>
            </article>
        </main>
    )
}
