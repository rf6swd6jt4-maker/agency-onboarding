"use client"

import { useMemo, useState } from "react"
import { OnboardingSessionRenderer, type OnboardingRenderStep } from "@/components/onboarding/OnboardingSessionRenderer"
import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout"
import { OnboardingThemeProvider } from "@/components/onboarding/OnboardingThemeProvider"
import type { OnboardingPaymentDefinitionV2 } from "@/lib/onboarding/block-definition"
import type { OnboardingBookendDefinition, OnboardingHelpSettings, OnboardingModuleDefinition, OnboardingThemeDefinition } from "@/lib/onboarding/configuration-types"
import { bookendToRenderStep, configuredStepToRenderStep, visualStepToRenderStep } from "@/lib/onboarding/render-model"

type PreviewClient = {
    name: string | null
    email: string | null
    phone: string | null
    isTest?: boolean
}

type PreviewItem = {
    key: string
    step: OnboardingRenderStep
}

export function BuilderPreview({
    module: moduleDefinition,
    modules,
    bookend,
    payment,
    theme,
    help,
    workspaceName = "Your agency",
    logoSrc,
    client = { name: "Preview client", email: null, phone: null, isTest: true },
    privacyPolicyUrl,
    termsOfServiceUrl,
    fullWindow = false,
}: {
    module?: OnboardingModuleDefinition | null
    modules?: OnboardingModuleDefinition[]
    bookend?: OnboardingBookendDefinition | null
    payment?: OnboardingPaymentDefinitionV2 | null
    theme: OnboardingThemeDefinition
    help: OnboardingHelpSettings
    workspaceName?: string
    logoSrc?: string | null
    client?: PreviewClient
    privacyPolicyUrl?: string | null
    termsOfServiceUrl?: string | null
    fullWindow?: boolean
}) {
    const previewModules = useMemo(
        () => modules ?? (moduleDefinition ? [moduleDefinition] : []),
        [moduleDefinition, modules],
    )
    const previewItems = useMemo<PreviewItem[]>(() => {
        if (bookend) {
            return [{
                key: `bookend:${bookend.kind}:${bookend.id}`,
                step: bookendToRenderStep(bookend, bookend.resolvedVideoUrl),
            }]
        }
        return [
            ...(payment?.steps ?? []).map((step) => ({
                key: `payment:${step.id}`,
                step: visualStepToRenderStep("Payment", step),
            })),
            ...previewModules.flatMap((module) => module.steps.map((step) => ({
                key: `module:${module.id}:${step.id}`,
                step: configuredStepToRenderStep(module, step, step.resolvedVideoUrl),
            }))),
        ]
    }, [bookend, payment, previewModules])
    const [selectedIndex, setSelectedIndex] = useState(0)
    const clampedIndex = Math.min(selectedIndex, Math.max(0, previewItems.length - 1))
    const selected = previewItems[clampedIndex]
    const moduleTitles = previewModules
        .filter((module) => !["system-welcome", "system-completion"].includes(module.code))
        .map((module) => module.name)
    const roadmapSteps = previewItems.map((item, index) => ({
        key: item.key,
        title: item.step.title,
        complete: false,
        current: index === clampedIndex,
        href: null,
    }))
    const selectStep = (stepKey: string) => {
        const index = previewItems.findIndex((item) => item.key === stepKey)
        if (index >= 0) setSelectedIndex(index)
    }
    const advance = () => setSelectedIndex((index) => Math.min(Math.max(0, previewItems.length - 1), index + 1))
    const goBack = clampedIndex > 0 ? () => setSelectedIndex((index) => Math.max(0, index - 1)) : undefined
    const hasVisualForm = Boolean(selected?.step.blocks?.some((block) => block.kind === "form" && block.fields.length > 0))
    const needsContinueAction = Boolean(selected?.step.blocks?.length) ? !hasVisualForm : selected?.step.kind !== "form"
    const isPaymentStep = selected?.key.startsWith("payment:") ?? false

    return (
        <OnboardingThemeProvider theme={theme} className="h-full min-h-0">
            <OnboardingLayout
                embedded={!fullWindow}
                fullWindowPreview={fullWindow}
                roadmapSteps={roadmapSteps}
                client={client}
                workspaceName={workspaceName}
                logoSrc={logoSrc}
                help={help}
                footerText="Preview mode · nothing is saved"
                privacyPolicyUrl={privacyPolicyUrl}
                termsOfServiceUrl={termsOfServiceUrl}
                onRoadmapSelect={selectStep}
                allowRoadmapNavigation
                headerActions={<span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-950">Preview · nothing is saved</span>}
            >
                {selected ? (
                    <OnboardingSessionRenderer
                        key={selected.key}
                        step={{ ...selected.step, key: selected.key }}
                        moduleTitles={moduleTitles}
                        showModuleSummary
                        preview
                        onPreviewSubmit={advance}
                        onPreviewBack={goBack}
                        action={needsContinueAction && !isPaymentStep ? (
                            <button type="button" onClick={advance} className="block w-full rounded-xl bg-[var(--onboarding-primary,#1E3A5F)] px-5 py-4 text-center font-medium text-white transition active:scale-[0.99] active:opacity-80">{selected.step.navigation?.continueLabel || (bookend?.kind === "welcome" ? "Start onboarding" : "Complete and continue")}</button>
                        ) : null}
                    />
                ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-[var(--onboarding-surface)] p-8 text-center text-sm text-[var(--onboarding-muted)]">Add a step to preview the client experience.</div>
                )}
            </OnboardingLayout>
        </OnboardingThemeProvider>
    )
}
