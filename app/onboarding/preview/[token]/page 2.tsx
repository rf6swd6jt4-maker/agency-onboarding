import { createHash } from "crypto"
import Link from "next/link"
import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout"
import { OnboardingSessionRenderer } from "@/components/onboarding/OnboardingSessionRenderer"
import { OnboardingThemeProvider } from "@/components/onboarding/OnboardingThemeProvider"
import { loadOnboardingBuilderData, loadPublishedOnboardingConfiguration } from "@/lib/onboarding/configuration"
import { configuredStepToRenderStep } from "@/lib/onboarding/render-model"
import { createPrivateUploadSignedUrl } from "@/lib/onboarding/uploads"
import { supabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { robots: { index: false, follow: false } }

type PageProps = {
    params: Promise<{ token: string }>
    searchParams: Promise<{ step?: string }>
}

export default async function OnboardingPreviewPage({ params, searchParams }: PageProps) {
    const { token } = await params
    const { step: requestedStepId } = await searchParams
    if (!/^[0-9a-f]{64}$/.test(token)) return <InvalidPreview />
    const tokenHash = createHash("sha256").update(token).digest("hex")
    const { data: preview } = await supabaseAdmin
        .from("onboarding_preview_tokens")
        .select("workspace_id, module_id")
        .eq("token_hash", tokenHash)
        .is("revoked_at", null)
        .gt("expires_at", "now")
        .maybeSingle()
    if (!preview) return <InvalidPreview />

    const [builder, runtime, workspaceResult] = await Promise.all([
        loadOnboardingBuilderData(preview.workspace_id, preview.module_id),
        loadPublishedOnboardingConfiguration(preview.workspace_id),
        supabaseAdmin.from("workspaces").select("name").eq("id", preview.workspace_id).maybeSingle(),
    ])
    const moduleDefinition = builder.selectedModule
    if (!moduleDefinition || moduleDefinition.id !== preview.module_id || moduleDefinition.status === "archived" || !moduleDefinition.steps.length) return <InvalidPreview />
    const selectedIndex = Math.max(0, moduleDefinition.steps.findIndex((step) => step.id === requestedStepId))
    const configuredStep = moduleDefinition.steps[selectedIndex] ?? moduleDefinition.steps[0]
    const nextStep = moduleDefinition.steps[selectedIndex + 1]
    const videoUrl = configuredStep.videoPath
        ? await createPrivateUploadSignedUrl(configuredStep.videoPath)
        : configuredStep.videoUrl
    const step = configuredStepToRenderStep(moduleDefinition, configuredStep, videoUrl)
    const nextHref = nextStep ? `/onboarding/preview/${token}?step=${nextStep.id}` : null
    const roadmapSteps = moduleDefinition.steps.map((candidate, index) => ({
        key: candidate.id,
        title: candidate.title,
        complete: index < selectedIndex,
        current: candidate.id === configuredStep.id,
        href: index <= selectedIndex ? `/onboarding/preview/${token}?step=${candidate.id}` : null,
    }))

    return (
        <OnboardingThemeProvider theme={runtime.theme}>
            <OnboardingLayout
                roadmapSteps={roadmapSteps}
                client={{ name: "Preview client", email: null, phone: null, isTest: true }}
                workspaceName={workspaceResult.data?.name ?? "Your agency"}
                help={runtime.help}
                headerActions={<span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-950">Preview · nothing is saved</span>}
            >
                <OnboardingSessionRenderer
                    step={step}
                    moduleTitles={[moduleDefinition.name]}
                    token={token}
                    preview
                    previewNextHref={nextHref}
                    action={configuredStep.kind === "video" && nextHref ? (
                        <Link href={nextHref} className="mt-8 block w-full rounded-xl bg-[var(--onboarding-primary,#1E3A5F)] px-5 py-4 text-center font-medium text-white">
                            Complete and continue
                        </Link>
                    ) : null}
                />
            </OnboardingLayout>
        </OnboardingThemeProvider>
    )
}

function InvalidPreview() {
    return <main className="flex min-h-screen items-center justify-center bg-[#F8F7F3] px-6 text-slate-900"><p>This preview link is invalid, expired, or revoked.</p></main>
}
