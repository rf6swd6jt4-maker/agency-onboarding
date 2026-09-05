import Link from "next/link"
import { Suspense } from "react"
import { notFound } from "next/navigation"
import { DetailDangerAction, DetailDangerButton, DetailDangerZone, DetailPageHeader } from "@/components/detail"
import { RelationshipStage, SquarePill } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { ClientContextPanel } from "@/components/workspace/ClientContextPanel"
import {
    fulfilmentDetailHref,
    getRelationship,
    onboardingDetailHref,
    type RelationshipRecord,
} from "@/lib/relationships"
import { effectiveGanttRanges, getRelationshipGanttPlan, type RelationshipGanttPlan } from "@/lib/relationship-gantt"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspacePanel } from "@/lib/workspace-access"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { loadPublishedOnboardingConfiguration } from "@/lib/onboarding/configuration"
import { buildRelationshipDealServiceOptions } from "@/lib/onboarding/service-display"
import { loadOnboardingServiceRevisionDisplays } from "@/lib/onboarding/service-revisions"
import { currentRelationshipWork, ensureCurrentRelationshipStage } from "@/lib/relationship-workflow"
import { archiveRelationship } from "../actions"
import { ArchiveRelationshipForm } from "./ArchiveRelationshipForm"
import { RelationshipDealWorkspace } from "./RelationshipDealWorkspace"
import { loadWorkspaceTeams } from "@/lib/teams/server"
import { loadWorkspaceClientBrandAssets } from "@/lib/client-branding/assets"
import { loadWorkspacePublicBranding } from "@/lib/client-branding/public-branding"
import { createPrivateUploadSignedUrl } from "@/lib/onboarding/uploads"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string; relationshipId: string }>
}

async function loadRelationshipPlan(workspaceSlug: string, relationship: RelationshipRecord, userId: string) {
    let plan = await getRelationshipGanttPlan(workspaceSlug, relationship)
    const workflowStageExists = plan.items.some((item) => item.workflowRole === "lifecycle_stage" && item.lifecyclePhase === relationship.lifecycle_phase)
    if (!workflowStageExists && relationship.lifecycle_phase !== "nurturing" && relationship.lifecycle_phase !== "completed_lost") {
        // New records create workflow work in their mutation path. Repair only
        // legacy/incomplete records here instead of writing on every page view.
        await ensureCurrentRelationshipStage({ workspaceId: relationship.workspace_id, relationshipId: relationship.id, phase: relationship.lifecycle_phase, assigneeId: userId })
        plan = await getRelationshipGanttPlan(workspaceSlug, relationship)
    }
    return plan
}

async function RelationshipPlanFact({ planPromise, kind }: { planPromise: Promise<RelationshipGanttPlan>; kind: "open" | "unscheduled" }) {
    const plan = await planPromise
    if (kind === "open") return plan.items.filter((item) => !["done", "canceled"].includes(item.status)).length
    const ranges = effectiveGanttRanges(plan.items)
    return plan.items.filter((item) => !ranges.has(item.id)).length
}

function RelationshipWorkspaceFallback() {
    return <div className="mt-5 space-y-5" aria-label="Loading relationship workspace" aria-busy="true">
        <section className="overflow-hidden rounded-2xl border border-neutral-800 bg-black">
            <div className="grid gap-px bg-neutral-900 sm:grid-cols-2 lg:grid-cols-4">
                {Array.from({ length: 8 }, (_, index) => <div key={index} className="min-h-20 bg-black p-4"><div className="h-3 w-20 animate-pulse rounded bg-neutral-800" /><div className="mt-3 h-5 w-32 max-w-full animate-pulse rounded bg-neutral-900" /></div>)}
            </div>
        </section>
        <section className="min-h-72 rounded-2xl border border-neutral-800 bg-black p-4">
            <div className="h-5 w-40 animate-pulse rounded bg-neutral-800" />
            <div className="mt-5 h-44 animate-pulse rounded-xl bg-neutral-900/70" />
        </section>
    </div>
}

async function RelationshipWorkspace({ workspaceId, workspaceSlug, workspaceName, userId, role, relationship, planPromise }: {
    workspaceId: string
    workspaceSlug: string
    workspaceName: string
    userId: string
    role: string
    relationship: RelationshipRecord
    planPromise: Promise<RelationshipGanttPlan>
}) {
    const [plan, servicesResult, membershipsResult, onboardingConfiguration, currentSaleResult, teamResult, twilioConnectionResult, publicBranding, brandAssets, lookedUpCurrentWork] = await Promise.all([
        planPromise,
        supabaseAdmin.from("relationship_services").select("service_key, service_id, service_revision_id, upfront_price_cents, recurring_price_cents, currency, assignee_user_id").eq("workspace_id", workspaceId).eq("relationship_id", relationship.id),
        supabaseAdmin.from("workspace_memberships").select("user_id").eq("workspace_id", workspaceId),
        loadPublishedOnboardingConfiguration(workspaceId),
        supabaseAdmin.from("client_sales")
            .select("id, status, stripe_checkout_session_id, stripe_checkout_status, stripe_checkout_url, created_at")
            .eq("workspace_id", workspaceId)
            .eq("relationship_id", relationship.id)
            .in("status", ["sale_confirmation_pending", "sold_confirmation_sending", "sold_awaiting_whatsapp_confirm", "sold_confirmation_failed", "onboarding_payment_pending", "onboarding_created", "onboarding_link_sent", "onboarding_link_failed", "payment_failed", "paid", "manual_consent_pending", "manual_consent_template_failed", "manual_awaiting_whatsapp_confirm", "retention_confirmed"])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        loadWorkspaceTeams(workspaceId),
        supabaseAdmin.from("workspace_integrations").select("enabled, connection_status").eq("workspace_id", workspaceId).eq("provider", "twilio_sms").maybeSingle(),
        loadWorkspacePublicBranding(workspaceId, workspaceName),
        loadWorkspaceClientBrandAssets(workspaceId),
        currentRelationshipWork({ workspaceId, relationshipId: relationship.id, userId, isManager: role === "owner" || role === "admin" }),
    ])
    if (servicesResult.error) throw new Error(servicesResult.error.message)
    const storedServices = servicesResult.data ?? []
    const memberIds = (membershipsResult.data ?? []).map((member) => member.user_id)
    const [agencyLogoSrc, previewModules, profilesResult, serviceRevisions] = await Promise.all([
        brandAssets.logoPath ? createPrivateUploadSignedUrl(brandAssets.logoPath) : null,
        Promise.all(onboardingConfiguration.modules.map(async (module) => ({
            ...module,
            steps: await Promise.all(module.steps.map(async (step) => ({
                ...step,
                resolvedVideoUrl: step.videoPath ? await createPrivateUploadSignedUrl(step.videoPath) : step.videoUrl,
                blocks: step.blocks ? await Promise.all(step.blocks.map(async (block) => block.kind === "video" && block.upload?.path
                    ? { ...block, upload: { ...block.upload, resolvedUrl: await createPrivateUploadSignedUrl(block.upload.path) } }
                    : block)) : undefined,
            }))),
        }))),
        memberIds.length ? supabaseAdmin.from("user_profiles").select("user_id, username, display_name").in("user_id", memberIds).order("username") : Promise.resolve({ data: [] }),
        loadOnboardingServiceRevisionDisplays(workspaceId, storedServices.map((service) => service.service_revision_id)),
    ])
    const members = profilesResult.data ?? []
    const serviceOptions = buildRelationshipDealServiceOptions({
        schemaReady: onboardingConfiguration.schemaReady,
        services: onboardingConfiguration.services,
        selected: storedServices,
        revisions: serviceRevisions,
    })
    const fallbackCurrentWork = plan.items.find((item) => (
        item.workflowRole === "lifecycle_stage"
        && !["done", "canceled"].includes(item.status)
        && item.assignees.some((assignee) => assignee.userId === userId)
    ))
    const currentWork = lookedUpCurrentWork ?? (fallbackCurrentWork ? {
        id: fallbackCurrentWork.id,
        title: fallbackCurrentWork.title,
        action: fallbackCurrentWork.workflowAction,
        role: fallbackCurrentWork.workflowRole,
        status: fallbackCurrentWork.status,
        unassignedCount: 0,
        blocked: false,
    } : null)
    const dealServices = serviceOptions.map((service) => {
        const configured = onboardingConfiguration.services.find((candidate) => candidate.id === service.serviceId || candidate.code === service.code)
        return {
            code: service.code,
            serviceId: service.serviceId,
            revisionId: service.revisionId,
            name: service.name,
            description: service.description,
            serviceType: service.serviceType,
            recurringName: service.recurringName,
            recurringDescription: service.recurringDescription,
            defaultBillingInterval: service.defaultBillingInterval,
            defaultBillingIntervalCount: service.defaultBillingIntervalCount,
            thumbnailUrl: service.thumbnailUrl,
            defaultUpfrontPriceCents: service.defaultUpfrontPriceCents,
            defaultRecurringPriceCents: service.defaultRecurringPriceCents,
            currency: service.currency,
            isTest: service.isTest,
            revisionNumber: service.revisionNumber,
            selected: Boolean(service.selected),
            selectedUpfrontPriceCents: Number(service.selected?.upfront_price_cents ?? service.defaultUpfrontPriceCents),
            selectedRecurringPriceCents: Number(service.selected?.recurring_price_cents ?? service.defaultRecurringPriceCents),
            selectedCurrency: String(service.selected?.currency ?? service.currency).toUpperCase(),
            selectedAssigneeId: service.selected?.assignee_user_id ?? service.defaultAssigneeId,
            moduleIds: configured?.modules.map((module) => module.moduleId) ?? [],
        }
    })

    return <RelationshipDealWorkspace
        workspaceSlug={workspaceSlug}
        workspaceName={publicBranding.displayName}
        logoSrc={agencyLogoSrc}
        privacyPolicyUrl={publicBranding.privacyPolicyUrl}
        termsOfServiceUrl={publicBranding.termsOfServiceUrl}
        relationshipId={relationship.id}
        updatedAt={relationship.updated_at}
        details={{
            primaryPersonName: relationship.primary_person_name,
            businessName: relationship.business_name ?? "",
            primaryContactRole: relationship.primary_contact_role ?? "",
            primaryPhone: relationship.primary_phone ?? "",
            whatsappPhone: relationship.whatsapp_phone ?? "",
            communicationPrimaryProvider: relationship.communication_primary_provider,
            communicationDeliveryMode: relationship.communication_delivery_mode,
            primaryEmail: relationship.primary_email ?? "",
            sellerUserId: relationship.seller_user_id ?? userId,
            fulfilmentManagerUserId: relationship.fulfilment_manager_user_id ?? "",
            fulfilmentTeamId: relationship.fulfilment_team_id ?? "",
            projectTimeframeDays: relationship.project_timeframe_days,
            description: relationship.notes_summary ?? "",
            lifecyclePhase: relationship.lifecycle_phase,
        }}
        members={members.map((member) => ({ id: member.user_id, name: member.display_name?.trim() || member.username }))}
        fulfilmentTeams={teamResult.teams.filter((team) => team.kind === "custom" && !team.archivedAt).map((team) => ({ id: team.id, name: team.name, responsibilities: team.responsibilities.map((responsibility) => ({ serviceId: responsibility.serviceId, userId: responsibility.userId })) }))}
        services={dealServices}
        modules={previewModules}
        payment={onboardingConfiguration.payment}
        theme={onboardingConfiguration.theme}
        help={onboardingConfiguration.help}
        schemaReady={onboardingConfiguration.schemaReady}
        whatsappVerified={onboardingConfiguration.help.whatsappVerified}
        twilioVerified={Boolean(twilioConnectionResult.data?.enabled && twilioConnectionResult.data.connection_status === "connected")}
        commercialLocked={Boolean(currentSaleResult.data)}
        plan={plan}
        canEdit={role === "owner" || role === "admin"}
        currentWork={currentWork}
    />
}

export default async function RelationshipDetailPage({ params }: PageProps) {
    const { workspaceSlug, relationshipId } = await params
    const { workspace, user, role } = await requireWorkspacePanel(workspaceSlug, "relationships")
    const relationship = await getRelationship(workspace.id, relationshipId)
    if (!relationship) notFound()
    const planPromise = loadRelationshipPlan(workspace.slug, relationship, user.id)
    const isOnboarding = ["onboarding", "onboarding_review"].includes(relationship.lifecycle_phase)
    const isFulfilment = relationship.lifecycle_phase === "fulfilment"

    return <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
        <div className="mx-auto max-w-[92rem]">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                    <DetailPageHeader
                        category="Relationship"
                        reference={shortId(relationship.id)}
                        title={relationship.primary_person_name}
                        subtitle={relationship.business_name ?? "No company saved"}
                        labels={<>{relationship.source_metadata.is_test === true ? <SquarePill tone="yellow">Test</SquarePill> : null}<RelationshipStage phase={relationship.lifecycle_phase} /></>}
                        facts={[
                            { label: "open", value: <Suspense fallback="—"><RelationshipPlanFact planPromise={planPromise} kind="open" /></Suspense> },
                            { label: "unscheduled", value: <Suspense fallback="—"><RelationshipPlanFact planPromise={planPromise} kind="unscheduled" /></Suspense> },
                        ]}
                        updated={formatRelativeTime(relationship.updated_at)}
                    />

                    <Suspense fallback={<RelationshipWorkspaceFallback />}>
                        <RelationshipWorkspace workspaceId={workspace.id} workspaceSlug={workspace.slug} workspaceName={workspace.name} userId={user.id} role={role} relationship={relationship} planPromise={planPromise} />
                    </Suspense>

                    <section className="mt-5 flex flex-wrap gap-2 border-t border-neutral-900 pt-5 text-sm">
                        {isOnboarding && <Link href={onboardingDetailHref(workspace.slug, relationship.id)} className="rounded-lg border border-neutral-800 px-3 py-2 text-neutral-300 hover:text-white">Open onboarding detail</Link>}
                        {isFulfilment && <Link href={fulfilmentDetailHref(workspace.slug, relationship.id)} className="rounded-lg border border-neutral-800 px-3 py-2 text-neutral-300 hover:text-white">Open fulfilment detail</Link>}
                    </section>

                    {(role === "owner" || role === "admin") ? <DetailDangerZone>
                        <DetailDangerAction
                            title="Archive relationship"
                            description="Removes it from active relationship lists and WhatsApp confirmation matching while preserving its billing records, messages, and other history."
                            control={<ArchiveRelationshipForm action={archiveRelationship.bind(null, workspace.slug, relationship.id)} relationshipName={relationship.business_name ?? relationship.primary_person_name} />}
                        />
                        <DetailDangerAction
                            title="Delete relationship permanently"
                            description="Permanent deletion will be enabled after the shared archive lifecycle and dependent-record safeguards are implemented."
                            control={<DetailDangerButton type="button" tone="delete" disabled>Delete permanently</DetailDangerButton>}
                        />
                    </DetailDangerZone> : null}
                </div>

                <ClientContextPanel workspaceSlug={workspace.slug} relationship={relationship} />
            </div>
        </div>
    </main>
}
