"use server"

import { submitSmsConsent as submit, type SmsConsentActionState } from "@/lib/client-sales/sms-consent"

export async function submitSmsConsent(token: string, state: SmsConsentActionState, formData: FormData) {
    return submit(token, state, formData)
}
