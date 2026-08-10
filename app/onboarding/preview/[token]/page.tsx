import { createHash } from "crypto"
import Link from "next/link"
import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout"
import { OnboardingSessionRenderer, type OnboardingRenderStep } from "@/components/onboarding/OnboardingSessionRenderer"
import { OnboardingThemeProvider } from "@/components/onboarding/OnboardingThemeProvider"
import type { OnboardingBlock, OnboardingBookendDefinitionV2, OnboardingModuleDefinitionV2, OnboardingStepV2 } from "@/lib/onboarding/block-definition"
import { loadOnboardingBuilderData, loadPublishedOnboardingConfiguration } from "@/lib/onboarding/configuration"
import type { OnboardingHelpSettings, OnboardingThemeDefinition } from "@/lib/onboarding/configuration-types"
import { configuredStepToRenderStep } from "@/lib/onboarding/render-model"
import { createPrivateUploadSignedUrl } from "@/lib/onboarding/uploads"
import { supabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const metadata = { robots: { index: false, follow: false } }

type PageProps = {
    params: Promise<{ token: string }>
    searchParams: Promise<{ step?: string; complete?: string }>
}

type VisualPreviewSnapshot = {
    schemaVersion: 2
    workspaceName: string
    modules: OnboardingModuleDefinitionV2[]
    welcome: OnboardingBookendDefinitionV2
    completion: OnboardingBookendDefinitionV2
    theme: OnboardingThemeDefinition
    help: OnboardingHelpSettings
}

type PreviewStep = { groupTitle: string; step: OnboardingStepV2 }

function isVisualPreviewSnapshot(value: unknown): value is VisualPreviewSnapshot {
    if (!value || typeof value !== "object") return false
    const candidate = value as Partial<VisualPreviewSnapshot>
    return candidate.schemaVersion === 2
        && typeof candidate.workspaceName === "string"
        && Array.isArray(candidate.modules)
        && Boolean(candidate.welcome?.steps?.length)
        && Boolean(candidate.completion?.steps?.length)
        && Boolean(candidate.theme)
        && Boolean(candidate.help)
}

async function resolveBlocks(blocks: OnboardingBlock[]) {
    return Promise.all(blocks.map(async (block) => {
        if (block.kind !== "video" || !block.upload?.path) return block
        const resolvedUrl = await createPrivateUploadSignedUrl(block.upload.path)
        return { ...block, upload: { ...block.upload, resolvedUrl } }
    }))
}

async function visualRenderStep(item: PreviewStep): Promise<OnboardingRenderStep> {
    const blocks = await resolveBlocks(item.step.blocks)
    const header = blocks.find((block) => block.kind === "header")
    return {
        key: item.step.id,
        kind: "video",
        title: header?.kind === "header" ? header.title : "Untitled step",
        description: header?.kind === "header" ? header.description : "",
        moduleTitle: item.groupTitle,
        estimatedTime: header?.kind === "header" ? header.estimatedTime : "",
        why: "",
        blocks,
        navigation: item.step.navigation,
    }
}

export default async function OnboardingPreviewPage({ params, searchParams }: PageProps) {
    const { token } = await params
    const { step: requestedStepId, complete } = await searchParams
    if (!/^[0-9a-f]{64}$/.test(token)) return <InvalidPreview />
    const tokenHash = createHash("sha256").update(token).digest("hex")

    const { data: visualPreview } = await supabaseAdmin
        .from("onboarding_visual_preview_tokens")
        .select("snapshot")
        .eq("token_hash", tokenHash)
        .is("revoked_at", null)
        .gt("expires_at", "now")
        .maybeSingle()
    if (visualPreview && isVisualPreviewSnapshot(visualPreview.snapshot)) {
        const snapshot = visualPreview.snapshot
        const flatSteps: PreviewStep[] = [
            ...snapshot.welcome.steps.map((step) => ({ groupTitle: "Welcome", step })),
            ...snapshot.modules.flatMap((module) => module.steps.map((step) => ({ groupTitle: module.name, step }))),
            ...snapshot.completion.steps.map((step) => ({ groupTitle: "Completion", step })),
        ]
        if (!flatSteps.length) return <InvalidPreview />
        const requestedIndex = flatSteps.findIndex((item) => item.step.id === requestedStepId)
        const selectedIndex = requestedIndex >= 0 ? requestedIndex : 0
        const selected = flatSteps[selectedIndex]
        const renderStep = await visualRenderStep(selected)
        const finished = complete === "1" && selectedIndex === flatSteps.length - 1
        const nextHref = selectedIndex < flatSteps.length - 1
            ? `/onboarding/preview/${token}?step=${flatSteps[selectedIndex + 1].step.id}`
            : `/onboarding/preview/${token}?step=${selected.step.id}&complete=1`
        const roadmapSteps = flatSteps.map((item, index) => ({
            key: item.step.id,
            title: item.step.blocks.find((block) => block.kind === "header")?.title || "Untitled step",
            complete: finished || index < selectedIndex,
            current: !finished && index === selectedIndex,
            href: index <= selectedIndex ? `/onboarding/preview/${token}?step=${item.step.id}` : null,
        }))
        return (
            <OnboardingThemeProvider theme={snapshot.theme}>
                <OnboardingLayout roadmapSteps={roadmapSteps} client={{ name: "Preview client", email: null, phone: null, isTest: true }} workspaceName={snapshot.workspaceName} help={snapshot.help} headerActions={<span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-950">Frozen preview · nothing is saved</span>}>
                    <OnboardingSessionRenderer
                        step={renderStep}
                        moduleTitles={snapshot.modules.map((module) => module.name)}
                        showModuleSummary
                        token={token}
                        preview
                        locked={finished}
                        previewNextHref={nextHref}
                        backHref={selectedIndex > 0 ? `/onboarding/preview/${token}?step=${flatSteps[selectedIndex - 1].step.id}` : null}
                        action={!renderStep.blocks?.some((block) => block.kind === "form") ? <Link href={nextHref} className="block w-full rounded-xl bg-[var(--onboarding-primary)] px-5 py-4 text-center font-medium text-white">{selected.step.navigation.continueLabel}</Link> : null}
                    />
                    {finished ? <p className="mt-5 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-900">Preview complete. No client or onboarding data was created.</p> : null}
                </OnboardingLayout>
            </OnboardingThemeProvider>
        )
    }

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
    const videoUrl = configuredStep.videoPath ? await createPrivateUploadSignedUrl(configuredStep.videoPath) : configuredStep.videoUrl
    const renderStep = configuredStepToRenderStep(moduleDefinition, configuredStep, videoUrl)
    const nextHref = nextStep ? `/onboarding/preview/${token}?step=${nextStep.id}` : null
    const roadmapSteps = moduleDefinition.steps.map((candidate, index) => ({ key: candidate.id, title: candidate.title, complete: index < selectedIndex, current: candidate.id === configuredStep.id, href: index <= selectedIndex ? `/onboarding/preview/${token}?step=${candidate.id}` : null }))

    return (
        <OnboardingThemeProvider theme={runtime.theme}>
            <OnboardingLayout roadmapSteps={roadmapSteps} client={{ name: "Preview client", email: null, phone: null, isTest: true }} workspaceName={workspaceResult.data?.name ?? "Your agency"} help={runtime.help} headerActions={<span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-950">Preview · nothing is saved</span>}>
                <OnboardingSessionRenderer step={renderStep} moduleTitles={[moduleDefinition.name]} token={token} preview previewNextHref={nextHref} backHref={selectedIndex > 0 ? `/onboarding/preview/${token}?step=${moduleDefinition.steps[selectedIndex - 1].id}` : null} action={configuredStep.kind === "video" && nextHref ? <Link href={nextHref} className="mt-8 block w-full rounded-xl bg-[var(--onboarding-primary,#1E3A5F)] px-5 py-4 text-center font-medium text-white">Complete and continue</Link> : null} />
            </OnboardingLayout>
        </OnboardingThemeProvider>
    )
}

function InvalidPreview() {
    return <main className="flex min-h-screen items-center justify-center bg-[#F8F7F3] px-6 text-slate-900"><p>This preview link is invalid, expired, or revoked.</p></main>
}
