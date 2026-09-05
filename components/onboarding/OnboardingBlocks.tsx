"use client"

import { useMemo, useState, type ReactNode } from "react"
import { satisfyBlockRequirement } from "@/app/onboarding/session/[token]/actions"
import { OnboardingForm } from "@/components/onboarding/OnboardingForm"
import { AppointmentSetupBlock } from "@/components/onboarding/AppointmentSetupBlock"
import { CalendarDateTimeBlock } from "@/components/onboarding/CalendarDateTimeBlock"
import { RequestHelpLink } from "@/components/onboarding/RequestHelpLink"
import { StripePaymentButtonLabel } from "@/components/onboarding/StripePaymentButtonLabel"
import { WhyWeAskCard } from "@/components/onboarding/WhyWeAskCard"
import { ONBOARDING_PAYMENT_BUTTON_ID, type OnboardingBlock } from "@/lib/onboarding/block-definition"
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
    onPreviewBack,
    allowEditRequest,
    initiallySatisfied = [],
    initialBlockResponses = {},
    continueAction,
    continueLabel,
    backLabel,
    backHref,
    moduleTitles,
}: {
    blocks: RuntimeBlock[]
    token: string
    stepKey: string
    initialResponse?: FormResponse
    locked: boolean
    preview: boolean
    previewNextHref?: string | null
    onPreviewSubmit?: () => void
    onPreviewBack?: () => void
    allowEditRequest: boolean
    initiallySatisfied?: string[]
    initialBlockResponses?: Record<string, unknown>
    continueAction?: ReactNode
    continueLabel: string
    backLabel: string
    backHref?: string | null
    moduleTitles?: string[]
}) {
    const [satisfied, setSatisfied] = useState(() => new Set(initiallySatisfied))
    const [requirementError, setRequirementError] = useState<string | null>(null)
    const formBlock = blocks.find((block) => block.kind === "form")
    const requiredBlocks = blocks.filter((block) => (block.kind === "video" && block.requirement === "finish") || (block.kind === "button" && block.required) || block.kind === "calendar" || block.kind === "connection" || block.kind === "appointment_medium" || block.kind === "appointment_fields")
    const unsatisfied = requiredBlocks.filter((block) => !satisfied.has(block.sessionBlockId ?? block.id))
    const form = useMemo(() => formBlock?.kind === "form" && formBlock.fields.length > 0 ? {
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

    async function satisfy(block: RuntimeBlock, kind: "button_opened" | "video_finished" | "meta_ads_connected") {
        const id = block.sessionBlockId ?? block.id
        if (satisfied.has(id)) return
        if (preview || !block.sessionBlockId) {
            setSatisfied((current) => new Set(current).add(id))
            return
        }
        if (kind === "meta_ads_connected") {
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
        {blocks.filter((block) => block.kind !== "header" && block.kind !== "estimate").map((block) => {
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
            if (block.kind === "checklist") {
                const items = block.source === "modules" ? (moduleTitles ?? []) : block.items
                return <BlockFrame key={block.id} block={block}>
                    <div className="rounded-2xl bg-[var(--onboarding-page)] p-5">
                        <p className="font-semibold text-[var(--onboarding-text)]">{block.title}</p>
                        <ul className="mt-4 space-y-2 text-sm leading-6 text-[var(--onboarding-text)]">{items.length ? items.map((item, index) => <li key={`${item}-${index}`} className="flex gap-2"><span aria-hidden="true" className="font-semibold text-[var(--onboarding-primary)]">✓</span><span>{item}</span></li>) : <li className="text-[var(--onboarding-muted)]">No onboarding modules assigned yet.</li>}</ul>
                        {block.footer ? <p className="mt-4 text-sm leading-6 text-[var(--onboarding-muted)]">{block.footer}</p> : null}
                    </div>
                </BlockFrame>
            }
            if (block.kind === "appointment_medium" || block.kind === "appointment_fields") {
                const requirementId = block.sessionBlockId ?? block.id
                return <BlockFrame key={block.id} block={block}><AppointmentSetupBlock block={block} token={token} initialResponse={initialBlockResponses[requirementId]} locked={locked} preview={preview} satisfied={satisfied.has(requirementId)} onSatisfied={() => setSatisfied((current) => new Set(current).add(requirementId))} onUnsatisfied={() => setSatisfied((current) => { const next = new Set(current); next.delete(requirementId); return next })} /></BlockFrame>
            }
            if (block.kind === "calendar") {
                const requirementId = block.sessionBlockId ?? block.id
                return <BlockFrame key={block.id} block={block}><CalendarDateTimeBlock block={block} token={token} sessionBlockId={block.sessionBlockId} initialResponse={initialBlockResponses[requirementId]} locked={locked} preview={preview} satisfied={satisfied.has(requirementId)} onSatisfied={() => setSatisfied((current) => new Set(current).add(requirementId))} onUnsatisfied={() => setSatisfied((current) => { const next = new Set(current); next.delete(requirementId); return next })} /></BlockFrame>
            }
            if (block.kind === "connection") {
                const requirementId = block.sessionBlockId ?? block.id
                const connected = satisfied.has(requirementId)
                const href = preview || !block.sessionBlockId ? undefined : `/api/onboarding/session/${encodeURIComponent(token)}/meta-ads/start?block=${encodeURIComponent(block.sessionBlockId)}`
                return <BlockFrame key={block.id} block={block}>
                    <div className="rounded-2xl border border-black/10 bg-[var(--onboarding-page)] p-5">
                        <p className="font-semibold text-[var(--onboarding-text)]">Facebook Ads</p>
                        {block.description ? <p className="mt-2 text-sm leading-6 text-[var(--onboarding-muted)]">{block.description}</p> : null}
                        {connected ? <div className="mt-4 inline-flex min-h-12 items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-5 py-3 font-medium text-emerald-900"><span aria-hidden="true">✓</span> Facebook connected</div> : preview ? <button type="button" onClick={() => void satisfy(block, "meta_ads_connected")} className="mt-4 inline-flex min-h-12 items-center justify-center rounded-xl bg-[var(--onboarding-primary)] px-5 py-3 font-medium text-white">{block.label}</button> : <a href={href} className="mt-4 inline-flex min-h-12 items-center justify-center rounded-xl bg-[var(--onboarding-primary)] px-5 py-3 font-medium text-white">{block.label}</a>}
                        {!connected && !locked ? <p className="mt-2 text-xs text-[var(--onboarding-muted)]">Connect Facebook to continue.</p> : null}
                    </div>
                </BlockFrame>
            }
            const requirementId = block.sessionBlockId ?? block.id
            const paymentButton = block.id === ONBOARDING_PAYMENT_BUTTON_ID
            return <BlockFrame key={block.id} block={block}>
                <a href={preview ? undefined : block.url} target={preview || block.openInSameTab ? undefined : "_blank"} rel={preview || block.openInSameTab ? undefined : "noopener noreferrer"} onClick={(event) => { if (preview) event.preventDefault(); void satisfy(block, "button_opened") }} className={paymentButton ? "inline-flex min-h-12 items-center justify-center rounded-xl bg-[#635bff] px-5 py-3 font-medium text-white shadow-sm transition hover:bg-[#5851e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#635bff]/40 focus-visible:ring-offset-2" : block.appearance === "secondary" ? "inline-flex min-h-12 items-center justify-center rounded-xl border border-[var(--onboarding-primary)] px-5 py-3 font-medium text-[var(--onboarding-primary)]" : "inline-flex min-h-12 items-center justify-center rounded-xl bg-[var(--onboarding-primary)] px-5 py-3 font-medium text-white"}>{paymentButton ? <StripePaymentButtonLabel /> : block.label}</a>
                {block.required && !locked ? <p className="mt-2 text-xs text-[var(--onboarding-muted)]">{satisfied.has(requirementId) ? "✓ Opened" : "Open this link to continue."}</p> : null}
            </BlockFrame>
        })}
        {(!locked && form) || continueAction ? <div className={`mt-8 grid items-start gap-3 ${backHref || onPreviewBack ? "grid-cols-[auto_minmax(0,1fr)]" : "grid-cols-1"}`}>{onPreviewBack ? <button type="button" onClick={onPreviewBack} className="inline-flex min-h-14 items-center justify-center rounded-xl border border-[var(--onboarding-primary)] px-5 font-medium text-[var(--onboarding-primary)]">{backLabel}</button> : backHref ? <a href={backHref} className="inline-flex min-h-14 items-center justify-center rounded-xl border border-[var(--onboarding-primary)] px-5 font-medium text-[var(--onboarding-primary)]">{backLabel}</a> : null}{form && !locked ? <button type="submit" form={formId} disabled={unsatisfied.length > 0} className="min-h-14 w-full rounded-xl bg-[var(--onboarding-primary)] px-5 py-4 font-medium text-white transition active:scale-[0.99] active:opacity-80 disabled:cursor-not-allowed disabled:opacity-60">{continueLabel}</button> : <fieldset disabled={unsatisfied.length > 0} className="contents">{continueAction}</fieldset>}</div> : null}
        {unsatisfied.length > 0 && !locked ? <p className="mt-3 text-center text-xs text-[var(--onboarding-muted)]">Complete {unsatisfied.length === 1 ? "the required item" : `${unsatisfied.length} required items`} above to continue.</p> : null}
        {requirementError ? <p role="alert" className="mt-3 text-left text-sm text-red-700">{requirementError} <RequestHelpLink />.</p> : null}
    </>
}
