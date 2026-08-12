import Link from "next/link"
import { notFound } from "next/navigation"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { ClientContextPanel } from "@/components/workspace/ClientContextPanel"
import { DetailField, DetailFields, DetailPageHeader } from "@/components/detail"
import { CopyOnboardingLink, OnboardingDangerZone, OnboardingLinkControls } from "@/components/onboarding/OnboardingDetailActions"
import { archiveOnboarding, restartOnboarding, revokeOnboardingToken, rotateOnboardingToken } from "./actions"
import { getOnboardingForm } from "@/lib/onboarding/forms"
import { getOnboardingStepsForModules, type CanonicalSessionStep } from "@/lib/onboarding/canonical-helpers"
import { MODULES } from "@/lib/onboarding/modules"
import { relationshipServiceDisplayName } from "@/lib/onboarding/service-display"
import { loadOnboardingServiceRevisionDisplays } from "@/lib/onboarding/service-revisions"
import { RelationshipStage, RoundPill, Status } from "@/components/ui"
import {
    assetHref,
    getRelationship,
    workItemHref,
} from "@/lib/relationships"
import { getProgressPercentage } from "@/lib/onboarding/progress"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"
import { loadNormalizedSessionSnapshot } from "@/lib/onboarding/session-snapshot"
import { getOnboardingUrl } from "@/lib/onboarding/client-creation"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string; relationshipId: string }>
}

type WorkItemRow = {
    id: string
    title: string
    description: string | null
    status: string
    sort_order: number | null
    metadata: Record<string, unknown> | null
    updated_at: string | null
    created_at: string
}

type AssetRow = {
    id: string
    title: string
    asset_kind: string | null
    native_kind: string | null
    metadata: Record<string, unknown> | null
    content_type: string | null
    file_size: number | null
    updated_at: string | null
    created_at: string
}

type StepStatus = "not_submitted" | "submitted" | "reviewed" | "waiting" | "blocked" | "canceled"

type OnboardingStepDetail = {
    key: string
    index: number
    anchorId: string
    title: string
    description: string
    moduleTitle: string
    kind: CanonicalSessionStep["kind"]
    formKey?: string
    fieldLabels: Record<string, string>
    editRequested: boolean
    item: WorkItemRow | null
    submission: AssetRow | null
    uploads: AssetRow[]
    status: StepStatus
    updatedAt: string | null
}

type TimelineItem =
    | { kind: "start"; label: string; done: boolean; href?: string }
    | { kind: "step"; step: OnboardingStepDetail; visibleNumber: number; current: boolean }
    | { kind: "final"; label: string; done: boolean; href?: string }

function metadataValue(metadata: unknown, key: string) {
    return metadata && typeof metadata === "object" && key in metadata
        ? String((metadata as Record<string, unknown>)[key] ?? "")
        : ""
}

function metadataRecord(metadata: unknown) {
    return metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? metadata as Record<string, unknown>
        : {}
}

function slugAnchor(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "step"
}

function formatFieldLabel(key: string, formKey?: string) {
    const form = getOnboardingForm(formKey)
    return form?.fields.find((field) => field.name === key)?.label ?? key.replace(/_/g, " ")
}

function responseEntries(submission: AssetRow | null, fieldLabels: Record<string, string>, formKey?: string) {
    const response = metadataRecord(submission?.metadata).response
    if (!response || typeof response !== "object" || Array.isArray(response)) return []
    return Object.entries(response as Record<string, unknown>).map(([key, value]) => ({
        key,
        label: fieldLabels[key] ?? formatFieldLabel(key, formKey),
        value,
    }))
}

function formatFileSize(size: number | null) {
    if (!size) return "Unknown size"
    if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
    return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function statusForStep(item: WorkItemRow | null, submission: AssetRow | null) {
    const reviewed = Boolean(metadataRecord(item?.metadata).reviewed_at || metadataRecord(submission?.metadata).reviewed_at)
    if (reviewed) return "reviewed"
    if (item?.status === "blocked") return "blocked"
    if (item?.status === "waiting") return "waiting"
    if (item?.status === "canceled") return "canceled"
    if (item?.status === "done" || submission) return "submitted"
    return "not_submitted"
}

function statusLabel(status: StepStatus) {
    if (status === "not_submitted") return "Not submitted"
    if (status === "submitted") return "Submitted"
    if (status === "reviewed") return "Reviewed"
    return status.replace(/_/g, " ")
}

function statusTone(status: StepStatus) {
    if (status === "reviewed") return "border-green-400/40 bg-green-950/30 text-green-100"
    if (status === "submitted") return "border-sky-400/40 bg-sky-950/30 text-sky-100"
    if (status === "blocked") return "border-red-500/30 bg-red-950/20 text-red-100"
    if (status === "canceled") return "border-neutral-700 bg-neutral-900 text-neutral-500"
    if (status === "waiting") return "border-amber-500/30 bg-amber-950/20 text-amber-100"
    return "border-neutral-700 bg-neutral-900 text-neutral-300"
}

function nodeTone(done: boolean, active = false) {
    if (done) return "border-white bg-white text-black"
    if (active) return "border-white bg-black text-white"
    return "border-neutral-700 bg-black text-neutral-400"
}

function CheckIcon({ className = "h-4 w-4" }: { className?: string }) {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className={`${className} fill-none stroke-current stroke-[3.25]`}><path d="m5 12 4 4L19 6" /></svg>
}

function ClockIcon({ className = "h-4 w-4" }: { className?: string }) {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className={`${className} fill-none stroke-current stroke-2`}><circle cx="12" cy="12" r="8" /><path d="M12 8v5l3 2" /></svg>
}

function FileIcon({ className = "h-4 w-4" }: { className?: string }) {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className={`${className} fill-none stroke-current stroke-2`}><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5" /></svg>
}

type StaffSessionStep = CanonicalSessionStep & { sessionStepId?: string | null; fieldLabels?: Record<string, string> }

function buildStepDetails(steps: StaffSessionStep[], workItems: WorkItemRow[], assets: AssetRow[], editRequestStepIds = new Set<string>()) {
    const itemByStep = new Map<string, WorkItemRow>()
    for (const item of workItems) {
        const stepKey = metadataValue(item.metadata, "session_step_id") || metadataValue(item.metadata, "step_key")
        if (stepKey) itemByStep.set(stepKey, item)
    }

    const submissionsByStep = new Map<string, AssetRow>()
    const uploadsByStep = new Map<string, AssetRow[]>()
    for (const asset of assets) {
        const stepKey = metadataValue(asset.metadata, "session_step_id") || metadataValue(asset.metadata, "step_key")
        if (!stepKey) continue
        if (asset.native_kind === "onboarding_form_submission") {
            const existing = submissionsByStep.get(stepKey)
            if (!existing || new Date(asset.updated_at ?? asset.created_at) > new Date(existing.updated_at ?? existing.created_at)) {
                submissionsByStep.set(stepKey, asset)
            }
        }
        if (asset.native_kind === "onboarding_upload") {
            uploadsByStep.set(stepKey, [...(uploadsByStep.get(stepKey) ?? []), asset])
        }
    }

    return steps.map((step, index): OnboardingStepDetail => {
        const item = itemByStep.get(step.key) ?? null
        const submission = submissionsByStep.get(step.key) ?? null
        const uploads = uploadsByStep.get(step.key) ?? []
        const dates = [item?.updated_at ?? item?.created_at, submission?.updated_at ?? submission?.created_at, ...uploads.map((asset) => asset.updated_at ?? asset.created_at)].filter(Boolean) as string[]
        const updatedAt = dates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null
        return {
            key: step.key,
            index,
            anchorId: `step-${slugAnchor(step.key)}`,
            title: item?.title ?? step.title,
            description: item?.description ?? step.description,
            moduleTitle: metadataValue(item?.metadata, "module_title") || step.moduleTitle,
            kind: step.kind,
            formKey: step.formKey,
            fieldLabels: step.fieldLabels ?? {},
            editRequested: Boolean(step.sessionStepId && editRequestStepIds.has(step.sessionStepId)),
            item,
            submission,
            uploads,
            status: statusForStep(item, submission),
            updatedAt,
        }
    })
}

function computeTimeline(steps: OnboardingStepDetail[], sessionStarted: boolean, sessionCompleted: boolean): TimelineItem[] {
    if (steps.length === 0) {
        return [
            { kind: "start", label: "Start", done: sessionStarted },
            { kind: "final", label: "Finish", done: sessionCompleted },
        ]
    }

    const currentStepIndex = steps.findIndex((step) => step.status === "not_submitted" || step.status === "blocked" || step.status === "waiting")
    const timeline: TimelineItem[] = [{ kind: "start", label: "Start", done: sessionStarted, href: steps[0] ? `#${steps[0].anchorId}` : undefined }]
    for (const step of steps) {
        timeline.push({ kind: "step", step, visibleNumber: step.index + 1, current: step.index === currentStepIndex })
    }
    timeline.push({ kind: "final", label: "Finish", done: sessionCompleted, href: sessionCompleted && steps.length ? `#${steps[steps.length - 1].anchorId}` : undefined })
    return timeline
}

function TimelineNode({ item }: { item: TimelineItem }) {
    if (item.kind === "start" || item.kind === "final") {
        const isFinal = item.kind === "final"
        const circleClass = "h-10 w-10"
        const iconClass = isFinal ? "h-5 w-5" : "h-4 w-4"
        const labelTone = isFinal ? "text-neutral-100" : item.done ? "text-neutral-100" : "text-neutral-500"
        const body = (
            <>
                <div className={`relative flex ${circleClass} items-center justify-center rounded-full border-2 ${nodeTone(item.done, false)}`}>
                    {item.done ? <CheckIcon className={iconClass} /> : <ClockIcon className={iconClass} />}
                </div>
                <span className={`mt-2 line-clamp-2 w-full whitespace-normal px-1 text-center text-xs font-medium leading-4 ${labelTone}`}>{item.label}</span>
            </>
        )
        return (
            <div className="relative z-10 flex min-w-0 flex-col items-center">
                {item.href ? <a href={item.href} className="relative flex flex-col items-center">{body}</a> : <div className="relative flex flex-col items-center">{body}</div>}
            </div>
        )
    }

    const done = item.step.status === "submitted" || item.step.status === "reviewed"
    const active = item.current
    const body = (
        <>
            <div className={`relative flex h-10 w-10 items-center justify-center rounded-full border-2 text-base font-semibold ${nodeTone(done, active)}`}>
                {done ? <CheckIcon /> : item.visibleNumber}
            </div>
            <span className={`mt-2 line-clamp-2 w-full whitespace-normal px-1 text-center text-xs font-medium leading-4 ${done || active ? "text-neutral-100" : "text-neutral-500"}`}>{item.step.title}</span>
        </>
    )
    return (
        <div className="relative z-10 flex min-w-0 flex-col items-center">
            {done ? <a href={`#${item.step.anchorId}`} className="relative flex flex-col items-center">{body}</a> : <div className="relative flex flex-col items-center">{body}</div>}
        </div>
    )
}

function MobileTimeline({ steps }: { steps: OnboardingStepDetail[] }) {
    const currentStepIndex = steps.findIndex((step) => step.status === "not_submitted" || step.status === "blocked" || step.status === "waiting")
    return (
        <ol className="grid gap-1 sm:hidden">
            {steps.map((step) => {
                const done = step.status === "submitted" || step.status === "reviewed"
                const content = (
                    <>
                        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${nodeTone(done, step.index === currentStepIndex)}`}>
                            {done ? <CheckIcon className="h-3.5 w-3.5" /> : step.index + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-neutral-100">{step.title}</span>
                            <span className="mt-0.5 block text-xs text-neutral-500">{statusLabel(step.status)}</span>
                        </span>
                    </>
                )
                return (
                    <li key={step.key} className="relative before:absolute before:bottom-[-0.25rem] before:left-[0.96875rem] before:top-8 before:w-px before:bg-neutral-800 last:before:hidden">
                        {done ? (
                            <a href={`#${step.anchorId}`} className="relative flex min-h-12 items-center gap-3 rounded-lg px-2 py-2 hover:bg-neutral-900">{content}</a>
                        ) : (
                            <div className="relative flex min-h-12 items-center gap-3 px-2 py-2">{content}</div>
                        )}
                    </li>
                )
            })}
        </ol>
    )
}

function AnswerValue({ value }: { value: unknown }) {
    if (Array.isArray(value)) {
        return <p className="mt-2 text-sm text-neutral-300">{value.length} uploaded file{value.length === 1 ? "" : "s"}</p>
    }
    const text = String(value || "").trim()
    return <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-100">{text || "No answer provided"}</p>
}

function StepInformationSection({ step, workspaceSlug }: { step: OnboardingStepDetail; workspaceSlug: string }) {
    const answers = responseEntries(step.submission, step.fieldLabels, step.formKey)
    const uploadsByField = new Map<string, AssetRow[]>()
    const ungroupedUploads: AssetRow[] = []
    for (const upload of step.uploads) {
        const fieldName = metadataValue(upload.metadata, "field_name")
        if (fieldName) uploadsByField.set(fieldName, [...(uploadsByField.get(fieldName) ?? []), upload])
        else ungroupedUploads.push(upload)
    }

    return (
        <section id={step.anchorId} className="scroll-mt-24 border-t border-neutral-900 px-5 py-5 first:border-t-0">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">{step.index + 1}. {step.moduleTitle}</span>
                        <span className={`rounded-full border px-2.5 py-1 text-xs capitalize ${statusTone(step.status)}`}>{statusLabel(step.status)}</span>
                        {step.editRequested ? <span className="rounded-full border border-amber-400/40 bg-amber-950/30 px-2.5 py-1 text-xs text-amber-100">Client requested an edit</span> : null}
                    </div>
                    <h3 className="mt-2 text-xl font-semibold tracking-tight text-neutral-100">{step.title}</h3>
                    <p className="mt-2 max-w-4xl text-sm leading-6 text-neutral-400">{step.description}</p>
                    <p className="mt-2 text-xs text-neutral-600">{step.updatedAt ? `Updated ${formatRelativeTime(step.updatedAt)}` : "No activity yet"}</p>
                </div>
                {step.item ? (
                    <Link href={workItemHref(workspaceSlug, step.item.id)} className="inline-flex min-h-10 shrink-0 items-center rounded-lg border border-neutral-800 px-3 text-sm text-neutral-300 hover:border-neutral-600 hover:text-white">
                        Open task
                    </Link>
                ) : null}
            </div>

            {answers.length > 0 ? (
                <div className="mt-5 grid gap-3">
                    {answers.map((answer) => (
                        <div key={answer.key} className="rounded-lg border border-neutral-900 bg-neutral-950 px-4 py-3">
                            <p className="text-sm font-medium text-neutral-300">{answer.label}</p>
                            <AnswerValue value={answer.value} />
                            {(uploadsByField.get(answer.key) ?? []).length > 0 ? (
                                <div className="mt-3 grid gap-2">
                                    {(uploadsByField.get(answer.key) ?? []).map((upload) => (
                                        <AssetRowLink key={upload.id} asset={upload} workspaceSlug={workspaceSlug} />
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    ))}
                </div>
            ) : (
                <div className="mt-5 rounded-lg border border-dashed border-neutral-800 bg-neutral-950 px-4 py-4">
                    <p className="text-sm font-medium text-neutral-200">
                        {step.kind === "video" && step.status === "submitted" ? "Instruction step completed." : step.status === "not_submitted" ? "Not submitted yet." : "No form answers were captured for this step."}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-neutral-500">
                        {step.kind === "video" ? "This step exists as a completion marker and reference point." : "When the client submits this step, their answers will appear here."}
                    </p>
                </div>
            )}

            {ungroupedUploads.length > 0 ? (
                <div className="mt-4">
                    <p className="text-sm font-medium text-neutral-300">Uploaded assets</p>
                    <div className="mt-2 grid gap-2">
                        {ungroupedUploads.map((upload) => (
                            <AssetRowLink key={upload.id} asset={upload} workspaceSlug={workspaceSlug} />
                        ))}
                    </div>
                </div>
            ) : null}
        </section>
    )
}

function AssetRowLink({ asset, workspaceSlug }: { asset: AssetRow; workspaceSlug: string }) {
    return (
        <Link href={assetHref(workspaceSlug, asset.id)} className="grid gap-2 rounded-lg border border-neutral-800 bg-black px-3 py-2 text-sm hover:border-neutral-600 sm:grid-cols-[auto_1fr_auto] sm:items-center">
            <span className="hidden h-8 w-8 items-center justify-center rounded-lg border border-neutral-800 text-neutral-400 sm:inline-flex"><FileIcon /></span>
            <span className="min-w-0">
                <span className="block truncate text-neutral-100">{asset.title}</span>
                <span className="mt-0.5 block text-xs text-neutral-600">{asset.content_type ?? asset.asset_kind ?? "Asset"}</span>
            </span>
            <span className="text-xs text-neutral-500 sm:text-right">{formatFileSize(asset.file_size)}</span>
        </Link>
    )
}

export default async function OnboardingDetailPage({ params }: PageProps) {
    const { workspaceSlug, relationshipId } = await params
    const { workspace, user, role } = await requireWorkspace(workspaceSlug)
    const relationship = await getRelationship(workspace.id, relationshipId)
    if (!relationship) notFound()

    const [
        { data: session },
        { data: modules },
        { data: services },
    ] = await Promise.all([
        supabaseAdmin
            .from("relationship_onboarding_sessions")
            .select("*")
            .eq("workspace_id", workspace.id)
            .eq("relationship_id", relationship.id)
            .in("status", ["active", "completed"])
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        supabaseAdmin
            .from("relationship_onboarding_modules")
            .select("module_key")
            .eq("workspace_id", workspace.id)
            .eq("relationship_id", relationship.id)
            .order("created_at", { ascending: true }),
        supabaseAdmin
            .from("relationship_services")
            .select("service_key, service_revision_id, due_date")
            .eq("workspace_id", workspace.id)
            .eq("relationship_id", relationship.id)
            .order("created_at", { ascending: true }),
    ])

    const moduleKeys = (modules ?? []).map((module) => module.module_key).filter((key): key is string => Boolean(key))
    const serviceRevisions = await loadOnboardingServiceRevisionDisplays(workspace.id, (services ?? []).map((service) => service.service_revision_id))
    const normalizedSnapshot = session ? await loadNormalizedSessionSnapshot(session) : null
    const canonicalSteps: StaffSessionStep[] = normalizedSnapshot
        ? normalizedSnapshot.actionableSteps.map((step) => ({
            key: step.id,
            sessionStepId: step.id,
            title: step.title,
            description: step.description,
            moduleTitle: step.moduleTitle,
            estimatedTime: step.estimatedTime,
            why: step.why,
            kind: step.kind === "completion" ? "final" : step.kind === "welcome" ? "video" : step.kind,
            formKey: step.legacyFormKey ?? undefined,
            videoUrl: step.videoUrl,
            fieldLabels: Object.fromEntries(step.fields.map((field) => [field.id, field.label])),
        }))
        : session ? getOnboardingStepsForModules(moduleKeys) : []
    const [{ data: workItems }, { data: assets }, { data: editRequests }] = session
        ? await Promise.all([
            supabaseAdmin
                .from("work_items")
                .select("id, title, description, status, sort_order, metadata, updated_at, created_at")
                .eq("workspace_id", workspace.id)
                .eq("native_kind", "onboarding_step")
                .like("native_key", `${session.id}:%`)
                .order("sort_order", { ascending: true }),
            supabaseAdmin
                .from("assets")
                .select("id, title, asset_kind, native_kind, metadata, content_type, file_size, updated_at, created_at")
                .eq("workspace_id", workspace.id)
                .in("native_kind", ["onboarding_form_submission", "onboarding_upload"])
                .like("native_key", `${session.id}:%`)
                .order("updated_at", { ascending: false }),
            normalizedSnapshot
                ? supabaseAdmin.from("onboarding_edit_requests").select("session_step_id").eq("workspace_id", workspace.id).eq("session_id", session.id).eq("status", "pending")
                : Promise.resolve({ data: [] as Array<{ session_step_id: string }> }),
        ])
        : [{ data: [] }, { data: [] }, { data: [] }]

    const steps = buildStepDetails(canonicalSteps, (workItems ?? []) as WorkItemRow[], (assets ?? []) as AssetRow[], new Set((editRequests ?? []).map((request) => request.session_step_id)))
    const submittedCount = steps.filter((step) => step.status === "submitted" || step.status === "reviewed").length
    const percentage = getProgressPercentage(steps.map((step) => ({ key: step.key })), steps.filter((step) => step.status === "submitted" || step.status === "reviewed").map((step) => step.key))
    const onboardingUrl = session ? getOnboardingUrl(workspace.slug, session.session_token, workspace.custom_onboarding_domain, workspace.custom_onboarding_domain_status === "verified") : null
    const canManage = role === "owner" || role === "admin"
    const sessionCompleted = session?.status === "completed"
    const timeline = computeTimeline(steps, Boolean(session), sessionCompleted)

    return (
        <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-[92rem]">
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="min-w-0">
                        <DetailPageHeader
                            category="Onboarding"
                            reference={shortId(relationship.id)}
                            title={relationship.primary_person_name}
                            subtitle={relationship.business_name ?? "No company saved"}
                            labels={<RelationshipStage phase={relationship.lifecycle_phase} />}
                            status={<Status label={sessionCompleted ? "Completed" : session ? "Active" : "Not started"} tone={sessionCompleted ? "green" : session ? "yellow" : "grey"} />}
                            facts={[
                                { label: "steps", value: `${submittedCount}/${steps.length}` },
                                { label: "assets", value: assets?.length ?? 0 },
                            ]}
                            updated={formatRelativeTime(session?.updated_at ?? relationship.updated_at)}
                        />

                        <DetailFields>
                            <DetailField label="Progress" icon="progress">{percentage}%</DetailField>
                            <DetailField label="Session" icon="status" className="lg:border-l lg:border-neutral-900 lg:pl-8"><Status label={sessionCompleted ? "Completed" : session ? "Active" : "Not started"} tone={sessionCompleted ? "green" : session ? "yellow" : "grey"} /></DetailField>
                            <DetailField label="Services" icon="services" className="lg:col-span-2">
                                <div className="flex flex-wrap gap-1.5">
                                    {(services ?? []).map((service) => <RoundPill key={`${service.service_key}:${service.service_revision_id ?? "legacy"}`} tone="emerald">{relationshipServiceDisplayName(service, serviceRevisions)}</RoundPill>)}
                                    {!services?.length ? <span className="text-neutral-600">None</span> : null}
                                </div>
                            </DetailField>
                            <DetailField label="Modules" icon="modules" className="lg:col-span-2">
                                <div className="flex flex-wrap gap-1.5">
                                    {(normalizedSnapshot?.modules ?? []).map((snapshotModule) => <RoundPill key={snapshotModule.id} tone="sky">{snapshotModule.title}</RoundPill>)}
                                    {!normalizedSnapshot && (modules ?? []).map((module) => <RoundPill key={module.module_key} tone="sky">{MODULES[module.module_key]?.title ?? module.module_key}</RoundPill>)}
                                    {!normalizedSnapshot?.modules.length && !modules?.length ? <span className="text-neutral-600">None</span> : null}
                                </div>
                            </DetailField>
                        </DetailFields>

                        <section className="mt-4 overflow-hidden rounded-xl border border-neutral-800 bg-black sm:mt-6">
                            <div className="border-b border-neutral-900 px-5 py-4">
                                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                                    <div>
                                        <h2 className="text-lg font-semibold">Onboarding timeline</h2>
                                        <p className="mt-1 text-sm text-neutral-500">Completed steps jump to the submitted information below.</p>
                                    </div>
                                    <Status label={sessionCompleted ? "Completed" : session ? "Active" : "Not started"} tone={sessionCompleted ? "green" : session ? "yellow" : "grey"} />
                                </div>
                            </div>
                            <div className="px-3 py-3 sm:px-4 sm:py-5">
                                <MobileTimeline steps={steps} />
                                <div className="hidden overflow-x-auto pb-1 sm:block">
                                    <div className="relative grid min-w-max items-start gap-3 px-5" style={{ gridTemplateColumns: `repeat(${timeline.length}, minmax(6.5rem, 1fr))` }}>
                                    <div className="absolute left-[3.25rem] right-[3.25rem] top-5 h-px bg-neutral-800" />
                                    {timeline.map((item, index) => (
                                        <TimelineNode key={item.kind === "step" ? item.step.key : `${item.kind}-${index}`} item={item} />
                                    ))}
                                    </div>
                                </div>
                            </div>
                        </section>

                        <section className="mt-6 rounded-xl border border-neutral-800 bg-black p-5">
                            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                                <div>
                                    <h2 className="text-lg font-semibold">Onboarding link</h2>
                                    <p className="mt-1 text-sm text-neutral-500">The client-facing canonical session link for this relationship.</p>
                                </div>
                                {session && canManage ? (
                                    <OnboardingLinkControls
                                        initialPath={onboardingUrl}
                                        revoked={Boolean(session.token_revoked_at)}
                                        revokeAction={revokeOnboardingToken.bind(null, workspace.slug, relationship.id)}
                                        rotateAction={rotateOnboardingToken.bind(null, workspace.slug, relationship.id)}
                                    />
                                ) : onboardingUrl && !session?.token_revoked_at ? (
                                    <div className="grid grid-cols-2 gap-2 sm:flex">
                                        <CopyOnboardingLink path={onboardingUrl} />
                                        <a href={onboardingUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-medium text-black">
                                            Preview session
                                        </a>
                                    </div>
                                ) : (
                                    <span className="text-sm text-neutral-500">No active session</span>
                                )}
                            </div>
                        </section>

                        <section className="mt-6 overflow-hidden rounded-xl border border-neutral-800 bg-black">
                            <div className="border-b border-neutral-900 px-5 py-4">
                                <h2 className="text-lg font-semibold">Client information</h2>
                                <p className="mt-1 text-sm text-neutral-500">Information submitted during onboarding stays available here after fulfilment starts.</p>
                            </div>
                            {steps.length ? steps.map((step) => (
                                <StepInformationSection key={step.key} step={step} workspaceSlug={workspace.slug} />
                            )) : (
                                <div className="px-5 py-6">
                                    <p className="font-medium text-neutral-100">No onboarding steps generated yet.</p>
                                    <p className="mt-2 text-sm leading-6 text-neutral-500">Start onboarding from the relationship page to generate the client-facing session and step work items.</p>
                                </div>
                            )}
                        </section>

                        {canManage ? (
                            <OnboardingDangerZone
                                hasSession={Boolean(session)}
                                archiveAction={archiveOnboarding.bind(null, workspace.slug, relationship.id)}
                                restartAction={restartOnboarding.bind(null, workspace.slug, relationship.id)}
                            />
                        ) : null}

                    </div>

                    <ClientContextPanel
                        workspaceSlug={workspace.slug}
                        relationship={relationship}
                        metrics={[
                            { label: "Progress", value: `${percentage}%` },
                            { label: "Assets", value: assets?.length ?? 0 },
                        ]}
                    />
                </div>
            </div>
        </main>
    )
}
