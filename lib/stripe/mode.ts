export type StripeAccountMode = "live" | "test"

export function stripeAccountMode(input: {
    credential?: string | null
    configuredLivemode?: string | null
    accountLivemode?: boolean
}): StripeAccountMode {
    if (input.configuredLivemode === "true") return "live"
    if (input.configuredLivemode === "false") return "test"

    const credential = input.credential?.trim() ?? ""
    if (/^(?:sk|rk)_live_/u.test(credential)) return "live"
    if (/^(?:sk|rk)_test_/u.test(credential)) return "test"
    if (typeof input.accountLivemode === "boolean") return input.accountLivemode ? "live" : "test"

    throw new Error("Stripe verified the credential, but Betelgeze could not determine whether it is a live or test key. Use an sk_live_, rk_live_, sk_test_, or rk_test_ credential.")
}
