export default function PaymentCancelledPage() {
    return <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 py-12 text-white">
        <section className="w-full max-w-lg rounded-2xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl shadow-black/40 sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">Checkout paused</p>
            <h1 className="mt-3 text-3xl font-semibold">No payment was taken</h1>
            <p className="mt-3 text-base leading-7 text-neutral-400">You can return to the secure Stripe Checkout link from your email whenever you are ready, provided the link has not expired.</p>
            <p className="mt-6 text-sm text-neutral-500">Contact your agency if you need a new link or want to change the service arrangement.</p>
        </section>
    </main>
}
