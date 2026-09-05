import { getCanonicalSessionByToken, getCanonicalStepDraft, getFormResponseAsset } from "@/lib/onboarding/canonical"
import { getOnboardingForm } from "@/lib/onboarding/forms"
import { skipTestStep } from "./actions"
import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout"
import { ScrollToTopOnStepChange } from "@/components/onboarding/ScrollToTopOnStepChange"
import { OnboardingSessionRenderer } from "@/components/onboarding/OnboardingSessionRenderer"
import { TestClientMenu } from "@/components/onboarding/TestClientMenu"
import { OnboardingStepSubmit } from "@/components/onboarding/OnboardingStepSubmit"
import { headers } from "next/headers"
import { OnboardingThemeProvider } from "@/components/onboarding/OnboardingThemeProvider"
import { createPrivateUploadSignedUrl } from "@/lib/onboarding/uploads"
import { OnboardingSessionNotice } from "@/components/onboarding/OnboardingSessionNotice"
import { getFrozenOnboardingPaymentDefinition, getOnboardingPaymentContext, onboardingPaymentPending } from "@/lib/client-sales/onboarding-checkout"
import { ONBOARDING_PAYMENT_BUTTON_ID, stepEstimate, stepHeader } from "@/lib/onboarding/block-definition"
import { getClientPortalUrlForOnboardingSession } from "@/lib/client-portal/session"
import { redirect } from "next/navigation"
import type { Metadata } from "next"
import { clientFaviconIcons } from "@/lib/client-branding/favicon"
import { agencyBrandedMetadata, currentPublicPageUrl, loadClientPagePublicBranding, loadWorkspacePublicBranding } from "@/lib/client-branding/public-branding"
import { clientBrandLogoUrl, loadWorkspaceClientBrandAssets } from "@/lib/client-branding/assets"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ token: string }>
    searchParams: Promise<{ step?: string; payment?: string; reason?: string; meta?: string; connection_reason?: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { token } = await params
    const [branding, icons, canonicalUrl] = await Promise.all([
        loadClientPagePublicBranding("onboarding", token),
        clientFaviconIcons("onboarding", token),
        currentPublicPageUrl(),
    ])
    return {
        ...agencyBrandedMetadata(branding, "onboarding", canonicalUrl),
        robots: { index: false, follow: false },
        icons,
    }
}

export default async function CanonicalSessionPage({ params, searchParams }: PageProps) {
    const { token } = await params
    const { step: requestedStepKey, payment: paymentResult, reason: paymentReason, meta: metaResult, connection_reason: connectionReason } = await searchParams
    const requestHeaders = await headers()
    const customOnboardingDomain = requestHeaders.get("x-betelgeze-custom-onboarding-domain")
    const resolved = await getCanonicalSessionByToken(token)

    if (!resolved) {
        return (
            <main data-betelgeze-onboarding-session="invalid" className="flex min-h-screen items-center justify-center bg-[#F8F7F3] px-6 text-slate-900">
                <p>Invalid onboarding link.</p>
            </main>
        )
    }

    const { session, workspace, relationship, steps, completableSteps, completedKeys, moduleTitles, theme, help, notices, satisfiedBlockIds, blockResponses } = resolved
    const [publicBranding, brandAssets] = await Promise.all([
        loadWorkspacePublicBranding(workspace.id, workspace.name),
        loadWorkspaceClientBrandAssets(workspace.id),
    ])
    const logoSrc = clientBrandLogoUrl("onboarding", token, brandAssets.logoPath)
    if (session.status === "completed") {
        const clientPortalUrl = await getClientPortalUrlForOnboardingSession({
            workspaceId: session.workspace_id,
            relationshipId: session.relationship_id,
        })
        if (clientPortalUrl) redirect(clientPortalUrl)
    }
    const paymentContext = await getOnboardingPaymentContext(token)
    if (onboardingPaymentPending(paymentContext) && paymentContext) {
        const paymentDefinition = await getFrozenOnboardingPaymentDefinition(paymentContext)
        const paymentStep = paymentDefinition.steps[0]
        const header = stepHeader(paymentStep)
        const resolvedBlocks = await Promise.all(paymentStep.blocks.map(async (block) => {
            if (block.kind === "video" && block.upload?.path) return { ...block, upload: { ...block.upload, resolvedUrl: await createPrivateUploadSignedUrl(block.upload.path) } }
            if (block.id === ONBOARDING_PAYMENT_BUTTON_ID && block.kind === "button") return { ...block, url: `/api/onboarding/session/${token}/checkout`, required: true, openInSameTab: true }
            return block
        }))
        const roadmapSteps = [
            { key: "payment", title: "Payment", complete: false, current: true, href: null },
            ...steps.map((step) => ({ key: step.key, title: step.title, complete: false, current: false, href: null })),
        ]
        return <OnboardingThemeProvider theme={theme}><OnboardingLayout roadmapSteps={roadmapSteps} client={{ name: relationship.primary_person_name, email: relationship.primary_email, phone: relationship.primary_phone, isTest: session.is_test }} workspaceName={publicBranding.displayName} logoSrc={logoSrc} help={help} privacyPolicyUrl={publicBranding.privacyPolicyUrl} termsOfServiceUrl={publicBranding.termsOfServiceUrl}>
            <OnboardingSessionRenderer
                step={{ key: "payment", kind: "video", title: header.title, description: header.description, moduleTitle: "Payment", estimatedTime: stepEstimate(paymentStep)?.estimatedTime ?? header.estimatedTime, why: "", blocks: resolvedBlocks, navigation: paymentStep.navigation }}
                moduleTitles={moduleTitles}
                token={token}
                locked={false}
                preview={false}
                allowEditRequest={false}
                satisfiedBlockIds={[]}
                notice={paymentResult === "pending" ? <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Stripe is still confirming the payment. This page will unlock as soon as payment succeeds.</div> : paymentResult === "unavailable" ? <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">{paymentReason || "Payment could not be opened. Please try again or contact the team for help."}</div> : null}
            />
        </OnboardingLayout></OnboardingThemeProvider>
    }
    const linearCurrentStep = completableSteps.find((step) => !completedKeys.has(step.key)) ?? steps[steps.length - 1]
    const requestedCandidate = steps.find((step) => step.key === requestedStepKey)
    const requestedStep = requestedCandidate && (session.status === "completed" || completedKeys.has(requestedCandidate.key) || requestedCandidate.key === linearCurrentStep.key)
        ? requestedCandidate
        : null
    const currentStep = requestedStep ?? linearCurrentStep
    const isFinalStep = currentStep.kind === "final"
    const lastCompletableStep = completableSteps.at(-1) ?? null
    const everyCompletableStepIsDone = completableSteps.length > 0 && completableSteps.every((step) => completedKeys.has(step.key))
    const finalizationPending = session.status === "active" && everyCompletableStepIsDone
    const canFinalizeHere = finalizationPending && (isFinalStep || currentStep.key === lastCompletableStep?.key)
    const stepIsLocked = session.status === "completed" || completedKeys.has(currentStep.key)
    const currentStepIndex = steps.findIndex((step) => step.key === currentStep.key)
    const previousStep = currentStepIndex > 0 ? steps[currentStepIndex - 1] : null
    const roadmapSteps = [
        ...(paymentContext ? [{ key: "payment", title: "Payment", complete: true, current: false, href: null }] : []),
        ...steps.map((step) => ({
        key: step.key,
        title: step.title,
        complete: step.kind === "final" ? linearCurrentStep.kind === "final" : completedKeys.has(step.key),
        current: step.key === currentStep.key,
        href: session.status === "completed" || completedKeys.has(step.key) || step.key === linearCurrentStep.key
            ? customOnboardingDomain
                ? `/${token}?step=${step.key}`
                : `/onboarding/session/${token}?step=${step.key}`
            : null,
        })),
    ]
    const currentForm = currentStep.kind === "form" ? currentStep.form ?? getOnboardingForm(currentStep.formKey) : null
    const [submittedResponse, draft, storedVideoUrl, resolvedBlocks] = await Promise.all([
        currentStep.kind === "form" ? getFormResponseAsset(session.id, currentStep) : undefined,
        currentStep.kind === "form" && !stepIsLocked ? getCanonicalStepDraft(token, currentStep.key) : null,
        currentStep.videoPath ? createPrivateUploadSignedUrl(currentStep.videoPath) : null,
        Promise.all((currentStep.blocks ?? []).map(async (block) => block.kind === "video" && block.upload?.path
            ? { ...block, upload: { ...block.upload, resolvedUrl: await createPrivateUploadSignedUrl(block.upload.path) } }
            : block)),
    ])
    const initialResponse = submittedResponse ?? draft?.response
    const videoUrl = storedVideoUrl ?? currentStep.videoUrl ?? ""
    const visualFormBlock = currentStep.blocks?.find((block) => block.kind === "form")
    const usesDirectVisualCompletion = Boolean(currentStep.blocks?.length) && (!visualFormBlock || (visualFormBlock.kind === "form" && visualFormBlock.fields.length === 0))
    const migrationNotice = notices.find((notice) => (notice.sessionModuleId === currentStep.sessionModuleId || Boolean(currentStep.sessionStepId && notice.affectedStepIds.includes(currentStep.sessionStepId))) && (
            notice.requiresCompletion ? !notice.moduleCompletedAt : !notice.firstSeenAt
        )) ?? null

    return (
        <OnboardingThemeProvider theme={theme}>
        <OnboardingLayout
            roadmapSteps={roadmapSteps}
            client={{
                name: relationship.primary_person_name,
                email: relationship.primary_email,
                phone: relationship.primary_phone,
                isTest: session.is_test,
            }}
            workspaceName={publicBranding.displayName}
            logoSrc={logoSrc}
            help={help}
            privacyPolicyUrl={publicBranding.privacyPolicyUrl}
            termsOfServiceUrl={publicBranding.termsOfServiceUrl}
            headerActions={
                session.status === "active" && session.is_test && !isFinalStep ? (
                    <TestClientMenu
                        currentStepTitle={currentStep.title}
                        previousStepHref={
                            previousStep
                                ? customOnboardingDomain
                                    ? `/${token}?step=${previousStep.key}`
                                    : `/onboarding/session/${token}?step=${previousStep.key}`
                                : null
                        }
                        skipAction={async () => {
                            "use server"
                            return skipTestStep(token, currentStep.key)
                        }}
                    />
                ) : null
            }
        >
            <ScrollToTopOnStepChange stepKey={currentStep.key} />

            <OnboardingSessionRenderer
                step={{ ...currentStep, form: currentForm, videoUrl, blocks: resolvedBlocks }}
                moduleTitles={moduleTitles}
                showModuleSummary={Boolean(currentStep.blocks?.length) || (currentStep.kind === "video" && (currentStep.moduleTitle === "General" || ["welcome", "welcome-video"].includes(currentStep.legacyStepKey ?? "")))}
                token={token}
                initialResponse={initialResponse}
                locked={stepIsLocked}
                allowEditRequest={session.status === "active" && completedKeys.has(currentStep.key)}
                notice={metaResult === "connected" ? <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">Facebook is connected. You can continue onboarding.</div> : metaResult === "error" ? <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">{connectionReason || "Facebook could not be connected. Please try again."}</div> : migrationNotice ? (
                    <OnboardingSessionNotice
                        token={token}
                        noticeId={migrationNotice.id}
                        explanation={migrationNotice.explanation}
                        requiresCompletion={migrationNotice.requiresCompletion}
                        sections={migrationNotice.sections}
                    />
                ) : null}
                action={session.status === "active" && (canFinalizeHere || (!isFinalStep && (currentStep.kind === "video" || usesDirectVisualCompletion) && !stepIsLocked)) ? (
                    <OnboardingStepSubmit
                        token={token}
                        stepKey={canFinalizeHere && lastCompletableStep ? lastCompletableStep.key : currentStep.key}
                        label={canFinalizeHere || currentStep.key === lastCompletableStep?.key
                            ? ["", "Continue", "Complete and continue"].includes(currentStep.navigation?.continueLabel ?? "")
                                ? "Finish onboarding"
                                : currentStep.navigation?.continueLabel ?? "Finish onboarding"
                            : currentStep.navigation?.continueLabel || "Complete and continue"}
                    />
                ) : null}
                satisfiedBlockIds={[...satisfiedBlockIds]}
                blockResponses={blockResponses}
                backHref={previousStep ? (customOnboardingDomain ? `/${token}?step=${previousStep.key}` : `/onboarding/session/${token}?step=${previousStep.key}`) : null}
            />
        </OnboardingLayout>
        </OnboardingThemeProvider>
    )
}
