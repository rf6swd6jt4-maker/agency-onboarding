import Link from "next/link"
import type { Metadata } from "next"

export const metadata: Metadata = {
    title: "Privacy Policy | Betelgeze",
    description:
        "Privacy policy for the Betelgeze automation platform.",
}

const SECTIONS = [
    {
        title: "Information We Collect",
        body: [
            "We collect information clients provide during onboarding, including name, email address, mobile and WhatsApp numbers, business information, project requirements, uploaded files, form responses, communication preferences, and messages sent to an agency through Betelgeze.",
            "We may also collect technical information needed to operate the portal, such as timestamps, progress status, session identifiers, message delivery records, webhook records, and records of SMS consent or opt-out requests.",
        ],
    },
    {
        title: "How We Use Information",
        body: [
            "We use client information to provide onboarding, prepare and deliver agency services, communicate about active projects, manage client requests, maintain internal records, and improve our fulfilment process.",
            "We do not sell client personal information.",
        ],
    },
    {
        title: "WhatsApp Communications",
        body: [
            "If a client communicates with us through WhatsApp, messages may be processed through Meta WhatsApp Business Platform and routed into our internal project communication tools so our team can respond and keep a transparent record of project conversations.",
            "Clients should not send sensitive information through WhatsApp unless it is necessary for the project.",
        ],
    },
    {
        title: "SMS and MMS Communications",
        body: [
            "Betelgeze enables agencies to send and receive SMS and MMS through Twilio using an agency-owned phone number. Messages may include a consent confirmation, a secure onboarding link, service or project updates, requested information, and direct replies within an active client conversation. The agency identified in the message is the sender, and Betelgeze provides the communication technology used to route and retain the conversation.",
            "SMS consent must be freely given for the identified sender and stated purpose. Providing a mobile number alone does not authorize unrelated promotional messages, consent is not transferred between agencies, and agencies using Betelgeze are responsible for obtaining and retaining any consent required for their messages.",
            "Message frequency varies according to the client's onboarding, project activity, and conversation with the agency. Message and data rates may apply. Recipients can reply STOP to opt out of SMS messages and may reply HELP for assistance. After an opt-out, no further SMS messages will be sent unless the recipient later gives valid consent again, apart from a permitted final confirmation that the opt-out was processed.",
            "We do not sell, rent, or share mobile phone numbers, SMS opt-in data, or messaging consent with third parties or affiliates for marketing or promotional purposes. Operational providers such as Twilio may process mobile information only as needed to transmit messages, provide delivery and compliance functions, secure the service, and support Betelgeze's operation; they do not receive that information from us for their own marketing.",
        ],
    },
    {
        title: "Service Providers",
        body: [
            "We use trusted service providers to operate our systems, including hosting, database, file storage, project management, analytics, and communication providers. These providers process information only as needed to support our services.",
            "Examples may include Vercel, Supabase, Cloudflare R2, Twilio, Meta WhatsApp Business Platform, and similar operational tools.",
        ],
    },
    {
        title: "Data Retention",
        body: [
            "We keep client information for as long as needed to provide services, maintain project records, comply with legal obligations, resolve disputes, and support legitimate business operations.",
            "Messaging and consent records may be retained for as long as needed to document the communication, honour opt-out requests, meet legal or carrier requirements, and demonstrate when and how consent was obtained or withdrawn.",
            "Clients may request deletion of information where applicable, subject to records we must keep for legal, security, or business reasons.",
        ],
    },
    {
        title: "Security",
        body: [
            "We use reasonable technical and organizational safeguards to protect client information. No online system is completely secure, but we work to limit access to authorized team members and service providers who need the information for business purposes.",
        ],
    },
    {
        title: "Client Choices",
        body: [
            "Clients can ask us to correct, update, export, or delete personal information where applicable. Clients can stop messaging through WhatsApp at any time and can reply STOP to an SMS to withdraw SMS consent.",
        ],
    },
    {
        title: "Changes To This Policy",
        body: [
            "We may update this Privacy Policy from time to time. The updated version will be posted on this page with a new effective date.",
        ],
    },
]

export default function PrivacyPage() {
    return (
        <main className="min-h-screen bg-[#F8F7F3] px-5 py-8 text-slate-900 sm:px-6 sm:py-12">
            <article className="mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
                <Link
                    href="/"
                    className="text-sm font-medium text-[#1E3A5F] hover:underline"
                >
                    Betelgeze
                </Link>

                <h1 className="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">
                    Privacy Policy
                </h1>

                <p className="mt-3 text-sm text-slate-500">
                    Effective date: 17 August 2026
                </p>

                <p className="mt-6 leading-7 text-slate-700">
                    This Privacy Policy explains how Betelgeze collects, uses,
                    stores, and shares information when clients use our
                    onboarding portal, communicate with our team, or receive
                    agency services.
                </p>

                <div className="mt-8 space-y-8">
                    {SECTIONS.map((section) => (
                        <section key={section.title}>
                            <h2 className="text-xl font-semibold text-slate-950">
                                {section.title}
                            </h2>

                            <div className="mt-3 space-y-3">
                                {section.body.map((paragraph) => (
                                    <p
                                        key={paragraph}
                                        className="leading-7 text-slate-700"
                                    >
                                        {paragraph}
                                    </p>
                                ))}
                            </div>
                        </section>
                    ))}
                </div>

                <section className="mt-8 border-t border-slate-200 pt-8">
                    <h2 className="text-xl font-semibold text-slate-950">
                        Contact
                    </h2>

                    <p className="mt-3 leading-7 text-slate-700">
                        For privacy questions or requests, contact Betelgeze using
                        the contact details provided to you as a client, or
                        message our team through your active project
                        communication channel.
                    </p>
                </section>
            </article>
        </main>
    )
}
