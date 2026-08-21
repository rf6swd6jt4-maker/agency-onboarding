import { SiteHeader } from "@/components/marketing/SiteHeader"

export default function Home() {
    return <main className="min-h-screen bg-neutral-950 text-white"><SiteHeader /><section className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-3xl items-center justify-center px-6 py-20 text-center"><div><p className="text-sm text-neutral-400">A calmer operating system for client work.</p><h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-6xl">Business automation, made calmer.</h1><p className="mx-auto mt-5 max-w-xl text-base leading-7 text-neutral-300 sm:text-lg">A private home for client onboarding, operational work, and the systems that keep both moving.</p></div></section></main>
}
