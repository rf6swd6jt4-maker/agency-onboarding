import { getCanonicalSessionByToken, getCanonicalStepDraft, getFormResponseAsset } from "@/lib/onboarding/canonical"
import { getOnboardingForm } from "@/lib/onboarding/forms"
import { completeStep, skipTestStep } from "./actions"
import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout"
import { ScrollToTopOnStepChange } from "@/components/onboarding/ScrollToTopOnStepChange"
import { OnboardingSessionRenderer } from "@/components/onboarding/OnboardingSessionRenderer"
import { TestClientMenu } from "@/components/onboarding/TestClientMenu"
import { FormPendingOverlay } from "@/components/FormPendingOverlay"
import { headers } from "next/headers"
import { OnboardingThemeProvider } from "@/components/onboarding/OnboardingThemeProvider"
import { createPrivateUploadSignedUrl } from "@/lib/onboarding/uploads"
import { OnboardingSessionNotice } from "@/components/onboarding/OnboardingSessionNotice"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ token: string }>
    searchParams: Promise<{ step?: string }>
}

export default async function CanonicalSessionPage({ params, searchParams }: PageProps) {
    const { token } = await params
    const { step: requestedStepKey } = await searchParams
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

    const { session, workspace, relationship, steps, completableSteps, completedKeys, moduleTitles, theme, help, notices, satisfiedBlockIds } = resolved
    const linearCurrentStep = completableSteps.find((step) => !completedKeys.has(step.key)) ?? steps[steps.length - 1]
    const requestedCandidate = steps.find((step) => step.key === requestedStepKey)
    const requestedStep = requestedCandidate && (session.status === "completed" || completedKeys.has(requestedCandidate.key) || requestedCandidate.key === linearCurrentStep.key)
        ? requestedCandidate
        : null
    const currentStep = requestedStep ?? linearCurrentStep
    const isFinalStep = currentStep.kind === "final"
    const stepIsLocked = session.status === "completed" || completedKeys.has(currentStep.key)
    const currentStepIndex = steps.findIndex((step) => step.key === currentStep.key)
    const previousStep = currentStepIndex > 0 ? steps[currentStepIndex - 1] : null
    const roadmapSteps = steps.map((step) => ({
        key: step.key,
        title: step.title,
        complete: step.kind === "final" ? linearCurrentStep.kind === "final" : completedKeys.has(step.key),
        current: step.key === currentStep.key,
        href: session.status === "completed" || completedKeys.has(step.key) || step.key === linearCurrentStep.key
            ? customOnboardingDomain
                ? `/${token}?step=${step.key}`
                : `/onboarding/session/${token}?step=${step.key}`
            : null,
    }))
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
            workspaceName={workspace.name}
            help={help}
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
                            return skipTestStep(token, currentStep.key, currentStep.formKey)
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
                notice={migrationNotice ? (
                    <OnboardingSessionNotice
                        token={token}
                        noticeId={migrationNotice.id}
                        explanation={migrationNotice.explanation}
                        requiresCompletion={migrationNotice.requiresCompletion}
                        sections={migrationNotice.sections}
                    />
                ) : null}
                action={!isFinalStep && currentStep.kind === "video" && !stepIsLocked && session.status === "active" ? (
                    <form
                        action={async () => {
                            "use server"
                            await completeStep(token, currentStep.key)
                        }}
                    >
                        <FormPendingOverlay />
                        <button className="mt-8 w-full rounded-xl bg-[var(--onboarding-primary,#1E3A5F)] px-5 py-4 font-medium text-white transition active:scale-[0.99] active:opacity-80">
                            Complete and continue
                        </button>
                    </form>
                ) : null}
                satisfiedBlockIds={[...satisfiedBlockIds]}
                backHref={previousStep ? (customOnboardingDomain ? `/${token}?step=${previousStep.key}` : `/onboarding/session/${token}?step=${previousStep.key}`) : null}
            />
        </OnboardingLayout>
        </OnboardingThemeProvider>
    )
}
