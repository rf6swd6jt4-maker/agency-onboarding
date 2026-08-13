export default function PaymentCompletePage() {
    return <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 py-12 text-white">
        <section className="w-full max-w-lg rounded-2xl border border-emerald-400/25 bg-neutral-900 p-6 shadow-2xl shadow-black/40 sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">Payment received</p>
            <h1 className="mt-3 text-3xl font-semibold">Your recurring service is active</h1>
            <p className="mt-3 text-base leading-7 text-neutral-400">Stripe has securely recorded your payment method. Your agency will send the next onboarding instruction through WhatsApp.</p>
            <p className="mt-6 rounded-xl border border-neutral-800 bg-black/40 px-4 py-3 text-sm leading-6 text-neutral-500">You can close this page. Future charges follow the schedule shown during checkout.</p>
        </section>
    </main>
}
