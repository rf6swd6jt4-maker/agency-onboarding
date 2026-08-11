"use client"

import Link from "next/link"
import type { MandatoryModuleConfiguration, OnboardingBookendDefinition, OnboardingHelpSettings, OnboardingModuleSummary } from "@/lib/onboarding/configuration-types"

export function OnboardingSettings({ workspaceSlug, schemaReady }: {
    workspaceSlug: string
    modules: OnboardingModuleSummary[]
    mandatory: MandatoryModuleConfiguration
    welcome: OnboardingBookendDefinition
    completion: OnboardingBookendDefinition
    help: OnboardingHelpSettings
    schemaReady: boolean
}) {
    return <div className="space-y-5">
        <section className="flex flex-col gap-4 rounded-2xl border border-neutral-700 bg-gradient-to-br from-neutral-900 to-black p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div>
                <h3 className="font-semibold">Build the client journey</h3>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-400">Create modules, choose which are mandatory, connect service modules, and build every onboarding block in one place.</p>
            </div>
            <Link href={`/${workspaceSlug}/onboarding-builder`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg bg-white px-4 text-sm font-medium text-black">Open Onboarding Builder</Link>
        </section>
        {!schemaReady ? <p className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-100">The onboarding configuration schema is not available in this environment yet. Deploy the current migrations before publishing Builder changes.</p> : null}
    </div>
}
