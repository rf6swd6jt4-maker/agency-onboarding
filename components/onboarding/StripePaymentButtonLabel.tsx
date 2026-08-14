import Image from "next/image"

export function StripePaymentButtonLabel() {
    return <span className="inline-flex items-center justify-center gap-2.5" aria-label="Pay with Stripe">
        <span aria-hidden="true">Pay with</span>
        <Image
            src="/brand/stripe-wordmark-white.jpg"
            width={1278}
            height={520}
            alt=""
            unoptimized
            className="h-[1.15rem] w-auto mix-blend-screen"
        />
    </span>
}
