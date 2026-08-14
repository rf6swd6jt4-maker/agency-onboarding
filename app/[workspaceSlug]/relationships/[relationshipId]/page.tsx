import Link from "next/link"
import { notFound } from "next/navigation"
import { DetailDangerAction, DetailDangerButton, DetailDangerZone, DetailPageHeader } from "@/components/detail"
import { RelationshipStage, SquarePill } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { ClientContextPanel } from "@/components/workspace/ClientContextPanel"
import {
    getRelationship,
    onboardingDetailHref,
    fulfilmentDetailHref,
} from "@/lib/relationships"
import { effectiveGanttRanges, getRelationshipGanttPlan } from "@/lib/relationship-gantt"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { loadPublishedOnboardingConfiguration } from "@/lib/onboarding/configuration"
import { buildRelationshipDealServiceOptions } from "@/lib/onboarding/service-display"
import { loadOnboardingServiceRevisionDisplays } from "@/lib/onboarding/service-revisions"
import { currentRelationshipWork, ensureCurrentRelationshipStage } from "@/lib/relationship-workflow"
import { archiveRelationship, voidAndReopenRelationshipInvoice } from "../actions"
import { ArchiveRelationshipForm } from "./ArchiveRelationshipForm"
import { RelationshipDealWorkspace } from "./RelationshipDealWorkspace"
import { VoidInvoiceButton } from "./VoidInvoiceButton"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string; relationshipId: string }>
}

export default async function RelationshipDetailPage({ params }: PageProps) {
    const { workspaceSlug, relationshipId } = await params
    const { workspace, user, role } = await requireWorkspace(workspaceSlug)
    const relationship = await getRelationship(workspace.id, relationshipId)
    if (!relationship) notFound()
    await ensureCurrentRelationshipStage({ workspaceId: workspace.id, relationshipId: relationship.id, phase: relationship.lifecycle_phase, assigneeId: user.id })
    const plan = await getRelationshipGanttPlan(workspace.slug, relationship)
    const planRanges = effectiveGanttRanges(plan.items)
    const [servicesResult, membershipsResult, onboardingConfiguration, replaceableSaleResult] = await Promise.all([
        supabaseAdmin.from("relationship_services").select("service_key, service_id, service_revision_id, price_cents, currency, assignee_user_id").eq("workspace_id", workspace.id).eq("relationship_id", relationship.id),
        supabaseAdmin.from("workspace_memberships").select("user_id").eq("workspace_id", workspace.id),
        loadPublishedOnboardingConfiguration(workspace.id),
        supabaseAdmin.from("client_sales")
            .select("id, status, checkout_flow, billing_model, stripe_invoice_id, stripe_invoice_status, stripe_checkout_session_id, stripe_checkout_status, stripe_checkout_url, created_at")
            .eq("workspace_id", workspace.id)
            .eq("relationship_id", relationship.id)
            .in("status", ["invoice_sent", "payment_failed", "invoice_inactive", "sale_confirmation_pending", "sold_confirmation_sending", "sold_awaiting_whatsapp_confirm", "sold_confirmation_failed", "onboarding_payment_pending", "onboarding_link_sent", "onboarding_link_failed", "paid"])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
    ])
    const memberIds = (membershipsResult.data ?? []).map((member) => member.user_id)
    const profilesResult = memberIds.length ? await supabaseAdmin.from("user_profiles").select("user_id, username").in("user_id", memberIds).order("username") : { data: [] }
    const members = profilesResult.data ?? []
    let storedServices = servicesResult.data ?? []
    if (servicesResult.error) {
        if (servicesResult.error.code !== "42703" && !servicesResult.error.message.toLowerCase().includes("schema cache")) throw new Error(servicesResult.error.message)
        const legacyServices = await supabaseAdmin.from("relationship_services")
            .select("service_key, price_cents, currency, assignee_user_id")
            .eq("workspace_id", workspace.id).eq("relationship_id", relationship.id)
        if (legacyServices.error) throw new Error(legacyServices.error.message)
        storedServices = (legacyServices.data ?? []).map((service) => ({ ...service, service_id: null, service_revision_id: null }))
    }
    const serviceRevisions = await loadOnboardingServiceRevisionDisplays(workspace.id, storedServices.map((service) => service.service_revision_id))
    const serviceOptions = buildRelationshipDealServiceOptions({
        schemaReady: onboardingConfiguration.schemaReady,
        services: onboardingConfiguration.services,
        selected: storedServices,
        revisions: serviceRevisions,
    })
    const currentSale = replaceableSaleResult.data
    const paymentGateSaleActive = currentSale?.checkout_flow === "onboarding_payment_gate" && currentSale.status !== "invoice_inactive"
    const replaceableSale = currentSale && currentSale.checkout_flow !== "onboarding_payment_gate" && (
        currentSale.billing_model === "recurring"
            ? Boolean(currentSale.stripe_checkout_session_id) && (currentSale.status !== "invoice_inactive" || String(currentSale.stripe_checkout_status ?? "").toLowerCase() === "expired")
            : Boolean(currentSale.stripe_invoice_id) && (currentSale.status !== "invoice_inactive" || ["void", "voided"].includes(String(currentSale.stripe_invoice_status ?? "").toLowerCase()))
    ) ? currentSale : null
    const lookedUpCurrentWork = await currentRelationshipWork({ workspaceId: workspace.id, relationshipId: relationship.id, userId: user.id, isManager: role === "owner" || role === "admin" })
    // The Gantt plan is the authoritative rendered view. If the compact current-work
    // query temporarily misses a just-created link, keep the visible assigned stage actionable.
    const fallbackCurrentWork = plan.items.find((item) => (
        item.workflowRole === "lifecycle_stage"
        && !["done", "canceled"].includes(item.status)
        && item.assignees.some((assignee) => assignee.userId === user.id)
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
            checkoutDisplayName: service.checkoutDisplayName,
            checkoutDescription: service.checkoutDescription,
            thumbnailUrl: service.thumbnailUrl,
            defaultPriceCents: service.defaultPriceCents,
            currency: service.currency,
            isTest: service.isTest,
            revisionNumber: service.revisionNumber,
            selected: Boolean(service.selected),
            selectedPriceCents: Number(service.selected?.price_cents ?? service.defaultPriceCents),
            selectedCurrency: String(service.selected?.currency ?? service.currency).toUpperCase(),
            selectedAssigneeId: service.selected?.assignee_user_id ?? null,
            moduleIds: configured?.modules.map((module) => module.moduleId) ?? [],
        }
    })

    const isOnboarding = ["onboarding", "onboarding_review"].includes(relationship.lifecycle_phase)
    const isFulfilment = relationship.lifecycle_phase === "fulfilment"

    return (
        <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6">
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
                                { label: "open", value: plan.items.filter((item) => !["done", "canceled"].includes(item.status)).length },
                                { label: "unscheduled", value: plan.items.filter((item) => !planRanges.has(item.id)).length },
                            ]}
                            updated={formatRelativeTime(relationship.updated_at)}
                        />

                        <RelationshipDealWorkspace
                                workspaceSlug={workspace.slug}
                                workspaceName={workspace.name}
                                relationshipId={relationship.id}
                                details={{
                                    primaryPersonName: relationship.primary_person_name,
                                    businessName: relationship.business_name ?? "",
                                    primaryContactRole: relationship.primary_contact_role ?? "",
                                    primaryPhone: relationship.primary_phone ?? "",
                                    whatsappPhone: relationship.whatsapp_phone ?? "",
                                    primaryEmail: relationship.primary_email ?? "",
                                    sellerUserId: relationship.seller_user_id ?? user.id,
                                    fulfilmentManagerUserId: relationship.fulfilment_manager_user_id ?? "",
                                    projectTimeframeDays: relationship.project_timeframe_days,
                                    description: relationship.notes_summary ?? "",
                                    lifecyclePhase: relationship.lifecycle_phase,
                                }}
                                members={members.map((member) => ({ id: member.user_id, name: member.username }))}
                                services={dealServices}
                                modules={onboardingConfiguration.modules}
                                theme={onboardingConfiguration.theme}
                                help={onboardingConfiguration.help}
                                schemaReady={onboardingConfiguration.schemaReady}
                                whatsappVerified={onboardingConfiguration.help.whatsappVerified}
                                commercialLocked={paymentGateSaleActive || Boolean(replaceableSale && replaceableSale.status !== "invoice_inactive")}
                                plan={plan}
                                canEdit={role === "owner" || role === "admin"}
                                currentWork={currentWork}
                                frozenInvoiceNotice={replaceableSale ? <div className="mt-3 flex flex-col gap-3 rounded-lg border border-amber-500/25 bg-amber-950/10 p-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div><p className="text-sm font-medium text-amber-100">{replaceableSale.billing_model === "recurring" ? "Sent retainer checkout is frozen" : "Sent invoice is frozen"}</p><p className="mt-1 text-xs leading-5 text-neutral-400">{replaceableSale.billing_model === "recurring" ? "Expire it in Stripe to preserve this snapshot, reopen the deal for edits, and send a replacement checkout." : "Void it in Stripe to preserve this snapshot, reopen the deal for edits, and send a new replacement invoice."}</p></div>
                                    <VoidInvoiceButton referenceId={replaceableSale.billing_model === "recurring" ? replaceableSale.stripe_checkout_session_id! : replaceableSale.stripe_invoice_id!} kind={replaceableSale.billing_model === "recurring" ? "recurring" : "one_off"} alreadyVoided={replaceableSale.status === "invoice_inactive"} action={voidAndReopenRelationshipInvoice.bind(null, workspace.slug, relationship.id, replaceableSale.id)} />
                                </div> : null}
                        />

                        <section className="mt-5 flex flex-wrap gap-2 border-t border-neutral-900 pt-5 text-sm">
                            {isOnboarding && <Link href={onboardingDetailHref(workspace.slug, relationship.id)} className="rounded-lg border border-neutral-800 px-3 py-2 text-neutral-300 hover:text-white">Open onboarding detail</Link>}
                            {isFulfilment && <Link href={fulfilmentDetailHref(workspace.slug, relationship.id)} className="rounded-lg border border-neutral-800 px-3 py-2 text-neutral-300 hover:text-white">Open fulfilment detail</Link>}
                        </section>

                        {(role === "owner" || role === "admin") ? (
                            <DetailDangerZone>
                                <DetailDangerAction
                                    title="Archive relationship"
                                    description="Removes it from active relationship lists and WhatsApp confirmation matching while preserving its invoices, messages, and other history."
                                    control={<ArchiveRelationshipForm
                                        action={archiveRelationship.bind(null, workspace.slug, relationship.id)}
                                        relationshipName={relationship.business_name ?? relationship.primary_person_name}
                                    />}
                                />
                                <DetailDangerAction
                                    title="Delete relationship permanently"
                                    description="Permanent deletion will be enabled after the shared archive lifecycle and dependent-record safeguards are implemented."
                                    control={<DetailDangerButton type="button" tone="delete" disabled>Delete permanently</DetailDangerButton>}
                                />
                            </DetailDangerZone>
                        ) : null}

                    </div>

                    <ClientContextPanel workspaceSlug={workspace.slug} relationship={relationship} />
                </div>
            </div>
        </main>
    )
}
