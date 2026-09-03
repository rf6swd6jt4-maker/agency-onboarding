"use client"

import { useActionState } from "react"

type SmsConsentActionState = { ok: boolean; message: string }
const INITIAL_STATE: SmsConsentActionState = { ok: false, message: "" }

export function SmsConsentForm({
    action,
    workspaceName,
    phoneHint,
}: {
    action: (state: SmsConsentActionState, formData: FormData) => Promise<SmsConsentActionState>
    workspaceName: string
    phoneHint: string
}) {
    const [state, formAction, pending] = useActionState(action, INITIAL_STATE)

    if (state.ok) {
        return (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950" role="status">
                {state.message}
            </div>
        )
    }

    return (
        <form action={formAction} className="mt-6 space-y-5">
            <label className="block text-sm font-medium text-slate-900">
                Mobile phone number
                <input
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    required
                    placeholder="+1 555 123 4567"
                    aria-describedby="sms-phone-hint"
                    className="mt-2 h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-950 outline-none transition focus:border-[#1E3A5F] focus:ring-2 focus:ring-[#1E3A5F]/15"
                />
                <span id="sms-phone-hint" className="mt-1.5 block text-xs font-normal text-slate-500">
                    Enter the number {phoneHint} from your client record.
                </span>
            </label>

            <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                <input name="sms_consent" type="checkbox" value="yes" required className="mt-1 h-4 w-4 shrink-0 accent-[#1E3A5F]" />
                <span>
                    I agree to receive service-related SMS messages from <strong className="font-semibold text-slate-950">{workspaceName}</strong> about my client onboarding through Betelgeze. Message frequency varies. Msg &amp; data rates may apply. Reply HELP for help or STOP to opt out. Consent is not a condition of purchase.
                </span>
            </label>

            {state.message ? <p role="alert" className="text-sm leading-6 text-red-700">{state.message}</p> : null}

            <button type="submit" disabled={pending} className="h-12 w-full rounded-lg bg-[#1E3A5F] px-5 text-sm font-semibold text-white transition hover:bg-[#162D4A] disabled:cursor-wait disabled:opacity-60">
                {pending ? "Opting in…" : "Opt in to SMS"}
            </button>
        </form>
    )
}
