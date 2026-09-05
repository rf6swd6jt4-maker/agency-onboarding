"use client"

import type { FormResponse, OnboardingFormDefinition } from "@/lib/onboarding/forms"
import { OnboardingForm } from "@/components/onboarding/OnboardingForm"
import { WhyWeAskCard } from "@/components/onboarding/WhyWeAskCard"
import { OnboardingBlocks } from "@/components/onboarding/OnboardingBlocks"
import type { OnboardingBlock } from "@/lib/onboarding/block-definition"
import { onboardingBlockLayoutClasses } from "@/lib/onboarding/block-layout"

export type OnboardingRenderStep = {
    key: string
    sessionStepId?: string | null
    kind: "form" | "video" | "final"
    title: string
    description: string
    moduleTitle: string
    estimatedTime: string
    why: string
    videoUrl?: string | null
    form?: OnboardingFormDefinition | null
    blocks?: Array<OnboardingBlock & { sessionBlockId?: string; sourceBlockId?: string }>
    navigation?: { backLabel: string; continueLabel: string }
}

export type OnboardingSessionRenderModel = {
    step: OnboardingRenderStep
    moduleTitles: string[]
    showModuleSummary?: boolean
    token?: string
    initialResponse?: FormResponse
    locked?: boolean
    preview?: boolean
    previewNextHref?: string | null
    onPreviewSubmit?: () => void
    onPreviewBack?: () => void
    notice?: React.ReactNode
    allowEditRequest?: boolean
    action?: React.ReactNode
    satisfiedBlockIds?: string[]
    blockResponses?: Record<string, unknown>
    backHref?: string | null
    forceMobile?: boolean
}

function embeddedVideoUrl(value: string) {
    try {
        const url = new URL(value)
        if (url.hostname === "youtu.be") return `https://www.youtube-nocookie.com/embed/${url.pathname.split("/").filter(Boolean)[0]}`
        if (url.hostname.endsWith("youtube.com")) {
            const id = url.searchParams.get("v") ?? url.pathname.match(/\/(?:embed|shorts)\/([^/]+)/)?.[1]
            return id ? `https://www.youtube-nocookie.com/embed/${id}` : null
        }
        if (url.hostname.endsWith("vimeo.com")) {
            const id = url.pathname.split("/").filter(Boolean).at(-1)
            return id ? `https://player.vimeo.com/video/${id}` : null
        }
        if (url.hostname.endsWith("loom.com")) {
            const id = url.pathname.match(/\/(?:share|embed)\/([^/]+)/)?.[1]
            return id ? `https://www.loom.com/embed/${id}` : null
        }
    } catch {
        return null
    }
    return null
}

export function OnboardingSessionRenderer({
    step,
    moduleTitles,
    showModuleSummary = false,
    token = "preview",
    initialResponse,
    locked = false,
    preview = false,
    previewNextHref,
    onPreviewSubmit,
    onPreviewBack,
    notice,
    allowEditRequest = false,
    action,
    satisfiedBlockIds = [],
    blockResponses = {},
    backHref = null,
    forceMobile = false,
}: OnboardingSessionRenderModel) {
    const isFinalStep = step.kind === "final"
    const videoEmbedUrl = step.videoUrl ? embeddedVideoUrl(step.videoUrl) : null
    const visualHeader = step.blocks?.find((block) => block.kind === "header")
    const visualEstimate = step.blocks?.find((block) => block.kind === "estimate")

    if (visualHeader?.kind === "header" && step.blocks?.length) {
        return (
            <div className={`rounded-2xl border border-black/10 bg-[var(--onboarding-surface,#FFFFFF)] p-4 shadow-sm ${forceMobile ? "" : "sm:p-8"}`}>
                <div className={onboardingBlockLayoutClasses(visualHeader.layout)}>
                    <p className="text-sm font-semibold uppercase tracking-wide text-[var(--onboarding-primary,#1E3A5F)]">{step.moduleTitle}</p>
                    <h1 className="mt-2.5 text-2xl font-semibold leading-8 tracking-tight text-[var(--onboarding-text,#0F172A)] sm:mt-3 sm:text-3xl sm:leading-9">{visualHeader.title}</h1>
                    {visualHeader.description ? <p className="mt-3 text-base leading-7 text-[var(--onboarding-muted,#475569)] sm:mt-4 sm:text-lg">{visualHeader.description}</p> : null}
                </div>
                {visualEstimate?.kind === "estimate" && visualEstimate.estimatedTime ? <div className={onboardingBlockLayoutClasses(visualEstimate.layout)}><div className="inline-flex max-w-full rounded-full bg-[color-mix(in_srgb,var(--onboarding-accent,#F0B429)_14%,var(--onboarding-surface,#FFFFFF))] px-3 py-1 text-sm font-medium leading-5 text-[var(--onboarding-primary,#1E3A5F)]">Estimated time: {visualEstimate.estimatedTime}</div></div> : visualHeader.estimatedTime ? <div className="mt-5 inline-flex max-w-full rounded-full bg-[color-mix(in_srgb,var(--onboarding-accent,#F0B429)_14%,var(--onboarding-surface,#FFFFFF))] px-3 py-1 text-sm font-medium leading-5 text-[var(--onboarding-primary,#1E3A5F)]">Estimated time: {visualHeader.estimatedTime}</div> : null}
                {notice}
                {visualHeader.showComposedModuleSummary && showModuleSummary ? (
                    <div className="mt-6 rounded-2xl bg-[var(--onboarding-page,#F8F7F3)] p-4 sm:mt-8 sm:p-5">
                        <p className="font-semibold text-[var(--onboarding-text,#0F172A)]">Your onboarding includes:</p>
                        <div className="mt-4 flex flex-wrap gap-2">{moduleTitles.length ? moduleTitles.map((moduleTitle) => <span key={moduleTitle} className="rounded-full bg-[color-mix(in_srgb,var(--onboarding-primary,#1E3A5F)_9%,var(--onboarding-surface,#FFFFFF))] px-3 py-1 text-sm font-medium text-[var(--onboarding-primary,#1E3A5F)]">✓ {moduleTitle}</span>) : <span className="text-sm text-[var(--onboarding-muted,#475569)]">No onboarding modules assigned yet.</span>}</div>
                    </div>
                ) : null}
                <OnboardingBlocks
                    key={step.key}
                    blocks={step.blocks}
                    token={token}
                    stepKey={step.key}
                    sessionStepId={step.sessionStepId}
                    stepForm={step.form}
                    initialResponse={initialResponse}
                    locked={locked}
                    preview={preview}
                    previewNextHref={previewNextHref}
                    onPreviewSubmit={onPreviewSubmit}
                    onPreviewBack={onPreviewBack}
                    allowEditRequest={allowEditRequest}
                    initiallySatisfied={satisfiedBlockIds}
                    initialBlockResponses={blockResponses}
                    continueAction={action}
                    continueLabel={step.navigation?.continueLabel || "Complete and continue"}
                    backLabel={step.navigation?.backLabel || "Back"}
                    backHref={backHref}
                    moduleTitles={moduleTitles}
                />
            </div>
        )
    }

    return (
        <div className={`rounded-2xl border border-black/10 bg-[var(--onboarding-surface,#FFFFFF)] p-4 shadow-sm ${forceMobile ? "" : "sm:p-8"}`}>
            <p className="text-sm font-semibold uppercase tracking-wide text-[var(--onboarding-primary,#1E3A5F)]">
                {step.moduleTitle}
            </p>
            <h1 className="mt-2.5 text-2xl font-semibold leading-8 tracking-tight text-[var(--onboarding-text,#0F172A)] sm:mt-3 sm:text-3xl sm:leading-9">
                {step.title}
            </h1>
            <p className="mt-3 text-base leading-7 text-[var(--onboarding-muted,#475569)] sm:mt-4 sm:text-lg">
                {step.description}
            </p>
            {notice}
            <div className="mt-5 inline-flex max-w-full rounded-full bg-[color-mix(in_srgb,var(--onboarding-accent,#F0B429)_14%,var(--onboarding-surface,#FFFFFF))] px-3 py-1 text-sm font-medium leading-5 text-[var(--onboarding-primary,#1E3A5F)]">
                Estimated time: {step.estimatedTime}
            </div>

            {showModuleSummary ? (
                <div className="mt-6 rounded-2xl bg-[var(--onboarding-page,#F8F7F3)] p-4 sm:mt-8 sm:p-5">
                    <p className="font-semibold text-[var(--onboarding-text,#0F172A)]">Your onboarding includes:</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                        {moduleTitles.length ? moduleTitles.map((moduleTitle) => (
                            <span key={moduleTitle} className="rounded-full bg-[color-mix(in_srgb,var(--onboarding-primary,#1E3A5F)_9%,var(--onboarding-surface,#FFFFFF))] px-3 py-1 text-sm font-medium capitalize text-[var(--onboarding-primary,#1E3A5F)]">
                                ✓ {moduleTitle}
                            </span>
                        )) : <span className="text-sm text-[var(--onboarding-muted,#475569)]">No onboarding modules assigned yet.</span>}
                    </div>
                    <p className="mt-5 text-sm text-[var(--onboarding-muted,#475569)]">
                        You can leave and come back any time. Your progress is saved automatically.
                    </p>
                </div>
            ) : null}

            {(step.kind === "video" || isFinalStep) && step.videoUrl ? (
                <div className="mt-6 aspect-video overflow-hidden rounded-2xl bg-[var(--onboarding-primary,#1E3A5F)] sm:mt-8">
                    {videoEmbedUrl ? (
                        <iframe src={videoEmbedUrl} title={step.title} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen className="h-full w-full" />
                    ) : (
                        <video src={step.videoUrl} controls preload="metadata" className="h-full w-full bg-black" />
                    )}
                </div>
            ) : null}

            {!isFinalStep && step.kind === "form" ? step.form ? (
                <OnboardingForm
                    key={step.key}
                    token={token}
                    stepKey={step.key}
                    sessionStepId={step.sessionStepId}
                    form={step.form}
                    initialResponse={initialResponse}
                    locked={locked}
                    allowEditRequest={allowEditRequest}
                    preview={preview}
                    previewNextHref={previewNextHref}
                    onPreviewSubmit={onPreviewSubmit}
                />
            ) : (
                <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-900 sm:mt-8 sm:p-5">
                    This form has not been configured yet.
                </div>
            ) : null}

            {!isFinalStep ? <div className="mt-6 sm:mt-8"><WhyWeAskCard>{step.why}</WhyWeAskCard></div> : (
                <div className="mt-6 rounded-2xl border border-green-200 bg-green-50 p-4 text-green-900 sm:mt-8 sm:p-5">
                    <p className="font-semibold">What happens next?</p>
                    <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6">
                        <li>Our team reviews your information.</li>
                        <li>Your project moves into fulfilment.</li>
                        <li>We’ll contact you if anything else is needed.</li>
                    </ol>
                    <p className="mt-4 text-sm leading-6">{action ? "Finish onboarding below to open your client portal." : "You can close this page now. There is nothing else you need to do at this stage."}</p>
                </div>
            )}
            {action ? <div className={`mt-6 grid items-start gap-3 sm:mt-8 ${onPreviewBack || backHref ? "grid-cols-1 sm:grid-cols-[auto_minmax(0,1fr)]" : "grid-cols-1"}`}>{onPreviewBack ? <button type="button" onClick={onPreviewBack} className="inline-flex min-h-14 w-full items-center justify-center rounded-xl border border-[var(--onboarding-primary)] px-5 text-center font-medium text-[var(--onboarding-primary)] sm:w-auto">{step.navigation?.backLabel || "Back"}</button> : backHref ? <a href={backHref} className="inline-flex min-h-14 w-full items-center justify-center rounded-xl border border-[var(--onboarding-primary)] px-5 text-center font-medium text-[var(--onboarding-primary)] sm:w-auto">{step.navigation?.backLabel || "Back"}</a> : null}{action}</div> : null}
        </div>
    )
}
