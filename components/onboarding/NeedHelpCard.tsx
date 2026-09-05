import type { OnboardingHelpSettings } from "@/lib/onboarding/configuration-types"

export function NeedHelpCard({ help }: { help: OnboardingHelpSettings }) {
    const whatsappNumber = help.whatsappVerified && help.whatsappEnabled
        ? help.whatsappNumber?.replace(/\D/g, "")
        : null
    return (
        <div className="rounded-2xl bg-[var(--onboarding-primary,#1E3A5F)] p-4 text-white sm:p-5">
            <p className="text-sm font-semibold uppercase tracking-wide text-white/80">
                Need help?
            </p>

            <p className="mt-3 text-sm leading-6 text-white/90">
                {help.text}
            </p>
            {whatsappNumber ? (
                <a
                    href={`https://wa.me/${whatsappNumber}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-5 block w-full rounded-xl border border-white/30 px-4 py-3 text-center text-sm font-medium transition active:scale-[0.99] active:opacity-80"
                >
                    Ask on WhatsApp
                </a>
            ) : null}
        </div>
    )
}
