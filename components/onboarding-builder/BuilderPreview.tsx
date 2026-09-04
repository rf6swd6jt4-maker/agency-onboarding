"use client"

import { useState } from "react"
import { OnboardingSessionRenderer } from "@/components/onboarding/OnboardingSessionRenderer"
import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout"
import { OnboardingThemeProvider } from "@/components/onboarding/OnboardingThemeProvider"
import type { OnboardingBookendDefinition, OnboardingHelpSettings, OnboardingModuleDefinition, OnboardingThemeDefinition } from "@/lib/onboarding/configuration-types"
import { bookendToRenderStep, configuredStepToRenderStep } from "@/lib/onboarding/render-model"

export function BuilderPreview({
    module: moduleDefinition,
    bookend,
    theme,
    help,
    workspaceName = "Your agency",
    logoSrc,
}: {
    module?: OnboardingModuleDefinition | null
    bookend?: OnboardingBookendDefinition | null
    theme: OnboardingThemeDefinition
    help: OnboardingHelpSettings
    workspaceName?: string
    logoSrc?: string | null
}) {
    const steps = moduleDefinition?.steps ?? []
    const [selectedIndex, setSelectedIndex] = useState(0)
    const [furthestIndex, setFurthestIndex] = useState(0)
    const clampedIndex = Math.min(selectedIndex, Math.max(0, steps.length - 1))
    const configuredStep = steps[clampedIndex]
    const renderStep = bookend
        ? bookendToRenderStep(bookend, bookend.resolvedVideoUrl)
        : moduleDefinition && configuredStep
            ? configuredStepToRenderStep(moduleDefinition, configuredStep, configuredStep.resolvedVideoUrl)
            : null
    const roadmapSteps = bookend
        ? [{ key: `bookend-${bookend.kind}`, title: bookend.title, complete: false, current: true }]
        : steps.map((step, index) => ({
            key: step.id,
            title: step.title,
            complete: index < furthestIndex,
            current: index === clampedIndex,
            href: null,
        }))
    const advance = () => {
        const nextIndex = Math.min(Math.max(0, steps.length - 1), clampedIndex + 1)
        setFurthestIndex((index) => Math.max(index, nextIndex))
        setSelectedIndex(nextIndex)
    }

    return (
        <OnboardingThemeProvider theme={theme} className="h-full min-h-0">
            <OnboardingLayout
                embedded
                roadmapSteps={roadmapSteps}
                client={{ name: "Preview client", email: null, phone: null, isTest: true }}
                workspaceName={workspaceName}
                logoSrc={logoSrc}
                help={help}
                footerText="Preview mode · nothing is saved"
                onRoadmapSelect={(stepId) => {
                    const index = steps.findIndex((step) => step.id === stepId)
                    if (index >= 0 && index <= furthestIndex) setSelectedIndex(index)
                }}
                headerActions={<span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-950">Preview · nothing is saved</span>}
            >
                {renderStep ? (
                    <OnboardingSessionRenderer
                        step={renderStep}
                        moduleTitles={moduleDefinition ? [moduleDefinition.name] : []}
                        showModuleSummary={bookend?.kind === "welcome"}
                        preview
                        onPreviewSubmit={advance}
                        action={renderStep.kind === "video" ? (
                            <button type="button" onClick={bookend ? undefined : advance} className="mt-8 w-full rounded-xl bg-[var(--onboarding-primary,#1E3A5F)] px-5 py-4 font-medium text-white transition active:scale-[0.99] active:opacity-80">{bookend?.kind === "welcome" ? "Start onboarding" : "Complete and continue"}</button>
                        ) : null}
                    />
                ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-[var(--onboarding-surface)] p-8 text-center text-sm text-[var(--onboarding-muted)]">Add a step to preview the client experience.</div>
                )}
            </OnboardingLayout>
        </OnboardingThemeProvider>
    )
}
