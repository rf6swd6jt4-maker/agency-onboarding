"use client"

import { useMemo, useState, type ReactNode } from "react"
import { satisfyBlockRequirement } from "@/app/onboarding/session/[token]/actions"
import { OnboardingForm } from "@/components/onboarding/OnboardingForm"
import { WhyWeAskCard } from "@/components/onboarding/WhyWeAskCard"
import type { OnboardingBlock } from "@/lib/onboarding/block-definition"
import { onboardingBlockLayoutClasses } from "@/lib/onboarding/block-layout"
import type { FormResponse } from "@/lib/onboarding/forms"

type RuntimeBlock = OnboardingBlock & { sessionBlockId?: string; sourceBlockId?: string }

function BlockFrame({ block, children }: { block: RuntimeBlock; children: ReactNode }) {
    return <div className={onboardingBlockLayoutClasses(block.layout)}>{children}</div>
}

export function OnboardingBlocks({
    blocks,
    token,
    stepKey,
    initialResponse,
    locked,
    preview,
    previewNextHref,
    onPreviewSubmit,
    allowEditRequest,
    initiallySatisfied = [],
    continueAction,
    continueLabel,
    backLabel,
    backHref,
}: {
    blocks: RuntimeBlock[]
    token: string
    stepKey: string
    initialResponse?: FormResponse
    locked: boolean
    preview: boolean
    previewNextHref?: string | null
    onPreviewSubmit?: () => void
    allowEditRequest: boolean
    initiallySatisfied?: string[]
    continueAction?: ReactNode
    continueLabel: string
    backLabel: string
    backHref?: string | null
}) {
    const [satisfied, setSatisfied] = useState(() => new Set(initiallySatisfied))
    const [requirementError, setRequirementError] = useState<string | null>(null)
    const formBlock = blocks.find((block) => block.kind === "form")
    const requiredBlocks = blocks.filter((block) => (block.kind === "video" && block.requirement === "finish") || (block.kind === "button" && block.required))
    const unsatisfied = requiredBlocks.filter((block) => !satisfied.has(block.sessionBlockId ?? block.id))
    const form = useMemo(() => formBlock?.kind === "form" ? {
        key: stepKey,
        title: "",
        intro: "",
        fields: formBlock.fields.map((field) => ({
            name: field.id,
            label: field.label,
            type: field.type,
            required: field.required,
            helpText: field.helpText || undefined,
            placeholder: field.placeholder || undefined,
            accept: field.accept,
            multiple: field.multiple,
        })),
    } : null, [formBlock, stepKey])
    const formId = `onboarding-form-${stepKey.replace(/[^a-zA-Z0-9_-]/g, "")}`

    async function satisfy(block: RuntimeBlock, kind: "button_opened" | "video_finished") {
        const id = block.sessionBlockId ?? block.id
        if (satisfied.has(id)) return
        if (preview || !block.sessionBlockId) {
            setSatisfied((current) => new Set(current).add(id))
            return
        }
        const outcome = await satisfyBlockRequirement(token, block.sessionBlockId, kind)
        if (!outcome.ok) {
            setRequirementError(outcome.error)
            return
        }
        setSatisfied((current) => new Set(current).add(id))
    }

    return <>
        {blocks.filter((block) => block.kind !== "header").map((block) => {
            if (block.kind === "form") {
                if (!form) return null
                return <BlockFrame key={block.id} block={block}>
                    <OnboardingForm
                        token={token}
                        stepKey={stepKey}
                        form={form}
                        initialResponse={initialResponse}
                        locked={locked}
                        allowEditRequest={allowEditRequest}
                        preview={preview}
                        previewNextHref={previewNextHref}
                        onPreviewSubmit={onPreviewSubmit}
                        submitDisabled={unsatisfied.length > 0}
                        submitLabel={continueLabel}
                        showIntro={false}
                        formId={formId}
                        hideSubmit
                    />
                    {block.whyWeAsk ? <div className="mt-6"><WhyWeAskCard>{block.whyWeAsk}</WhyWeAskCard></div> : null}
                </BlockFrame>
            }
            if (block.kind === "video") {
                const source = block.upload?.resolvedUrl ?? block.upload?.path
                const requirementId = block.sessionBlockId ?? block.id
                return <BlockFrame key={block.id} block={block}>
                    {source ? <div className="aspect-video overflow-hidden rounded-2xl bg-black"><video src={source} controls preload="metadata" onEnded={() => void satisfy(block, "video_finished")} className="h-full w-full bg-black" /></div> : <div className="rounded-2xl border border-dashed border-black/20 bg-[var(--onboarding-page)] p-8 text-sm text-[var(--onboarding-muted)]">This video is unavailable.</div>}
                    {block.requirement === "finish" && !locked ? <p className="mt-2 text-xs text-[var(--onboarding-muted)]">{satisfied.has(requirementId) ? "✓ Finished" : "Watch to the end to continue."}</p> : null}
                </BlockFrame>
            }
            const requirementId = block.sessionBlockId ?? block.id
            return <BlockFrame key={block.id} block={block}>
                <a href={block.url} target="_blank" rel="noopener noreferrer" onClick={() => void satisfy(block, "button_opened")} className={block.appearance === "secondary" ? "inline-flex min-h-12 items-center justify-center rounded-xl border border-[var(--onboarding-primary)] px-5 py-3 font-medium text-[var(--onboarding-primary)]" : "inline-flex min-h-12 items-center justify-center rounded-xl bg-[var(--onboarding-primary)] px-5 py-3 font-medium text-white"}>{block.label}</a>
                {block.required && !locked ? <p className="mt-2 text-xs text-[var(--onboarding-muted)]">{satisfied.has(requirementId) ? "✓ Opened" : "Open this link to continue."}</p> : null}
            </BlockFrame>
        })}
        {!locked && (form || continueAction) ? <div className="mt-8 flex items-stretch gap-3">{backHref ? <a href={backHref} className="inline-flex min-h-14 items-center justify-center rounded-xl border border-[var(--onboarding-primary)] px-5 font-medium text-[var(--onboarding-primary)]">{backLabel}</a> : null}{form ? <button type="submit" form={formId} disabled={unsatisfied.length > 0} className="min-h-14 flex-1 rounded-xl bg-[var(--onboarding-primary)] px-5 py-4 font-medium text-white transition active:scale-[0.99] active:opacity-80 disabled:cursor-not-allowed disabled:opacity-60">{continueLabel}</button> : <fieldset disabled={unsatisfied.length > 0} className="min-w-0 flex-1 disabled:opacity-60 [&>*]:mt-0">{continueAction}</fieldset>}</div> : null}
        {unsatisfied.length > 0 && !locked ? <p className="mt-3 text-center text-xs text-[var(--onboarding-muted)]">Complete {unsatisfied.length === 1 ? "the required item" : `${unsatisfied.length} required items`} above to continue.</p> : null}
        {requirementError ? <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{requirementError}</p> : null}
    </>
}
