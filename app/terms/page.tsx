import Link from "next/link"
import type { Metadata } from "next"

export const metadata: Metadata = {
    title: "Terms and Conditions | Betelgeze",
    description: "Terms and conditions for Betelgeze Client Messaging.",
}

type TermsSection = {
    title: string
    body: string[]
    emphasis?: string[]
}

const SECTIONS: TermsSection[] = [
    {
        title: "Program Description",
        body: [
            "Betelgeze Client Messaging enables agencies using Betelgeze to send and receive transactional and service-related SMS and MMS with clients who have consented to communicate by text. Messages may include consent confirmations, secure onboarding links, account or project updates, requested information, service notifications, and direct replies within an active client conversation.",
            "The agency identified in each message is the sender. Betelgeze provides the communication platform used to route, deliver, and retain the conversation. This program is not used for third-party lead generation, affiliate marketing, or unrelated promotional messages.",
        ],
    },
    {
        title: "Consent and Enrollment",
        body: [
            "Recipients must give prior express consent directly to the identified agency for the stated messaging purpose. Providing a mobile number by itself does not constitute consent, SMS consent is not a condition of purchasing goods or services, and consent cannot be bought, sold, transferred, or applied to another agency or messaging program.",
            "Agencies using Betelgeze are responsible for collecting and retaining legally sufficient proof of consent. A recipient who initiates an SMS conversation may receive responses related to that conversation, but this does not authorize unrelated or indefinite recurring messages.",
        ],
    },
    {
        title: "Message Frequency and Charges",
        body: [
            "Message frequency varies according to the recipient's onboarding, project activity, service updates, and conversation with the agency. Message and data rates may apply according to the recipient's mobile plan. Betelgeze and the sending agency do not charge a separate fee merely for receiving SMS or MMS through this program.",
        ],
    },
    {
        title: "Help and Opt-Out",
        body: [
            "For assistance, reply HELP to the number that sent the message. Recipients may also contact the agency identified in the message through the support or project contact details it provided during onboarding, or email Betelgeze support at support@betelgeze.com.",
            "To stop receiving SMS or MMS from the program, reply STOP at any time. A final confirmation may be sent to acknowledge the opt-out; no further messages will be sent unless the recipient later provides valid consent again. Other standard opt-out keywords, including STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, and REVOKE, may also be recognized by the messaging provider.",
        ],
        emphasis: ["HELP", "STOP"],
    },
    {
        title: "Delivery and Carrier Disclaimer",
        body: [
            "Message delivery is subject to network availability, carrier filtering, device settings, and other factors outside Betelgeze's or the sending agency's control. Carriers are not liable for any delayed or undelivered messages.",
        ],
    },
    {
        title: "Acceptable Use",
        body: [
            "Recipients may not use the messaging program for unlawful, abusive, fraudulent, infringing, or harmful content. Agencies must comply with applicable law, carrier requirements, Twilio's messaging policies, and Betelgeze platform rules when sending messages.",
        ],
    },
    {
        title: "Privacy",
        body: [
            "Mobile information and messaging consent are handled as described in the Betelgeze Privacy Policy. Mobile phone numbers and SMS opt-in data are not sold, rented, or shared with third parties or affiliates for their marketing or promotional purposes.",
        ],
    },
    {
        title: "Changes to These Terms",
        body: [
            "We may update these Terms and Conditions to reflect changes to the program, law, or carrier requirements. The current version will remain publicly available on this page with its effective date.",
        ],
    },
]

function emphasizedText(value: string, terms: string[] = []) {
    if (!terms.length) return value
    const pattern = new RegExp(`\\b(${terms.join("|")})\\b`, "g")
    return value.split(pattern).map((part, index) => terms.includes(part)
        ? <strong key={`${part}:${index}`} className="font-bold text-slate-950">{part}</strong>
        : part)
}

export default function TermsPage() {
    return (
        <main className="min-h-screen bg-[#F8F7F3] px-5 py-8 text-slate-900 sm:px-6 sm:py-12">
            <article className="mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
                <Link href="/" className="text-sm font-medium text-[#1E3A5F] hover:underline">
                    Betelgeze
                </Link>

                <h1 className="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">
                    Terms and Conditions
                </h1>

                <p className="mt-3 text-sm text-slate-500">
                    Effective date: 17 August 2026
                </p>

                <p className="mt-6 leading-7 text-slate-700">
                    These Terms and Conditions govern participation in the
                    Betelgeze Client Messaging SMS and MMS program.
                </p>

                <div className="mt-8 space-y-8">
                    {SECTIONS.map((section) => (
                        <section key={section.title}>
                            <h2 className="text-xl font-semibold text-slate-950">
                                {section.title}
                            </h2>
                            <div className="mt-3 space-y-3">
                                {section.body.map((paragraph) => (
                                    <p key={paragraph} className="leading-7 text-slate-700">
                                        {emphasizedText(paragraph, section.emphasis)}
                                    </p>
                                ))}
                            </div>
                        </section>
                    ))}
                </div>

                <section className="mt-8 border-t border-slate-200 pt-8">
                    <h2 className="text-xl font-semibold text-slate-950">Contact</h2>
                    <p className="mt-3 leading-7 text-slate-700">
                        For messaging support, reply <strong>HELP</strong> to the
                        number that sent the message or contact the agency named
                        in the message using its supplied project contact details.
                        You can also email{" "}
                        <a href="mailto:support@betelgeze.com" className="font-medium text-[#1E3A5F] underline underline-offset-2">
                            support@betelgeze.com
                        </a>.
                    </p>
                    <p className="mt-3 leading-7 text-slate-700">
                        See the <Link href="/privacy" className="font-medium text-[#1E3A5F] underline underline-offset-2">Betelgeze Privacy Policy</Link> for information about how personal and mobile information is handled.
                    </p>
                </section>
            </article>
        </main>
    )
}
