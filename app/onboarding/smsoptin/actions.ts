"use server"

import { submitPublicSmsOptIn as submit } from "@/lib/client-sales/sms-consent"

type SmsOptInActionState = {
    ok: boolean
    message: string
}

export async function submitPublicSmsOptIn(state: SmsOptInActionState, formData: FormData) {
    return submit(state, formData)
}
