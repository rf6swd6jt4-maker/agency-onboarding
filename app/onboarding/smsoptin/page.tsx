import type { Metadata } from "next"
import { headers } from "next/headers"

import { SmsOptInForm } from "@/components/onboarding/SmsOptInForm"
import { getPublicSmsOptInWorkspace } from "@/lib/client-sales/sms-consent"
import { agencyBrandedMetadata, currentPublicPageUrl } from "@/lib/client-branding/public-branding"
import { submitPublicSmsOptIn } from "./actions"

export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
    const requestHeaders = await headers()
    const workspace = await getPublicSmsOptInWorkspace(requestHeaders.get("x-betelgeze-workspace-slug"))
    return agencyBrandedMetadata(workspace?.branding ?? null, "sms-opt-in", await currentPublicPageUrl())
}

export default async function SmsOptInPage() {
    const requestHeaders = await headers()
    const workspace = await getPublicSmsOptInWorkspace(requestHeaders.get("x-betelgeze-workspace-slug"))
    const agencyName = workspace?.branding.displayName
    const privacyPolicyUrl = workspace?.branding.privacyPolicyUrl
    const termsOfServiceUrl = workspace?.branding.termsOfServiceUrl

    return (
        <main className="min-h-screen bg-[#F8F7F3] px-5 py-8 text-slate-900 sm:px-6 sm:py-12">
            <article className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-9">
                <p className="text-sm font-semibold text-[#1E3A5F]">{agencyName ?? "SMS opt-in"}</p>
                <h1 className="mt-5 text-3xl font-semibold tracking-tight">SMS opt-in</h1>
                {workspace ? (
                    <>
                        <p className="mt-3 text-sm leading-6 text-slate-600">
                            Choose whether to receive text messages from <strong className="font-semibold text-slate-900">{agencyName}</strong> about your client onboarding and services.
                        </p>
                        <section aria-labelledby="sms-program-details" className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
                            <h2 id="sms-program-details" className="text-sm font-semibold text-slate-950">What you are opting in to</h2>
                            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-700">
                                <li>Confirmation requests and secure onboarding or payment links.</li>
                                <li>Updates about your onboarding and services from {agencyName}.</li>
                                <li>Message frequency varies. Message and data rates may apply.</li>
                                <li>Reply HELP for help or STOP to opt out at any time.</li>
                            </ul>
                        </section>
                        <SmsOptInForm action={submitPublicSmsOptIn} agencyName={workspace.branding.displayName} />
                    </>
                ) : (
                    <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                        Open the public SMS opt-in page on the agency website that directed you here.
                    </div>
                )}

                <p className="mt-6 text-xs leading-5 text-slate-500">
                    SMS consent is optional and is not a condition of purchase. You can continue working with the agency without opting in.
                    {termsOfServiceUrl || privacyPolicyUrl ? <> See {termsOfServiceUrl ? <a href={termsOfServiceUrl} className="font-medium text-[#1E3A5F] underline underline-offset-2">SMS Terms and Conditions</a> : null}{termsOfServiceUrl && privacyPolicyUrl ? " and " : null}{privacyPolicyUrl ? <a href={privacyPolicyUrl} className="font-medium text-[#1E3A5F] underline underline-offset-2">Privacy Policy</a> : null}.</> : null}
                </p>
            </article>
        </main>
    )
}
