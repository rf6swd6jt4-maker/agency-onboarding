import Link from "next/link"
import { notFound } from "next/navigation"
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
import { archiveRelationship, saveRelationshipCommercialDetails, voidAndReopenRelationshipInvoice } from "../actions"
import { ArchiveRelationshipForm } from "./ArchiveRelationshipForm"
import { RelationshipGantt } from "./RelationshipGantt"
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
            .select("id, status, stripe_invoice_id, stripe_invoice_status, created_at")
            .eq("workspace_id", workspace.id)
            .eq("relationship_id", relationship.id)
            .in("status", ["invoice_sent", "payment_failed", "invoice_inactive"])
            .not("stripe_invoice_id", "is", null)
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
    const replaceableSale = replaceableSaleResult.data && (
        replaceableSaleResult.data.status !== "invoice_inactive"
        || ["void", "voided"].includes(String(replaceableSaleResult.data.stripe_invoice_status ?? "").toLowerCase())
    ) ? replaceableSaleResult.data : null
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

    const isOnboarding = ["onboarding", "onboarding_review"].includes(relationship.lifecycle_phase)
    const isFulfilment = relationship.lifecycle_phase === "fulfilment"

    return (
        <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-[92rem]">
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="min-w-0">
                        <header className="flex flex-col gap-3 border-b border-neutral-800 pb-4 sm:flex-row sm:items-end sm:justify-between">
                            <div className="min-w-0">
                                <p className="font-mono text-xs text-neutral-600">Relationship {shortId(relationship.id)}</p>
                                <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight">{relationship.primary_person_name}</h1>
                                <p className="mt-1 truncate text-sm text-neutral-500">{relationship.business_name ?? "No company saved"}</p>
                            </div>
                            <div className="flex flex-wrap items-center gap-4 text-xs text-neutral-500">
                                <RelationshipStage phase={relationship.lifecycle_phase} />
                                <span><strong className="mr-1 text-neutral-200">{plan.items.filter((item) => !["done", "canceled"].includes(item.status)).length}</strong> open</span>
                                <span><strong className="mr-1 text-neutral-200">{plan.items.filter((item) => !planRanges.has(item.id)).length}</strong> unscheduled</span>
                                <span>Updated {formatRelativeTime(relationship.updated_at)}</span>
                            </div>
                        </header>

                        <RelationshipGantt workspaceSlug={workspace.slug} relationshipId={relationship.id} plan={plan} canEdit={role === "owner" || role === "admin"} currentWork={currentWork} />

                        {(role === "owner" || role === "admin") ? <details className="mt-5 border-t border-neutral-900 pt-4">
                            <summary className="cursor-pointer text-sm font-medium text-neutral-300 hover:text-white">Commercial details and delivery team</summary>
                            {replaceableSale?.stripe_invoice_id ? <div className="mt-3 flex flex-col gap-3 rounded-lg border border-amber-500/25 bg-amber-950/10 p-3 sm:flex-row sm:items-center sm:justify-between">
                                <div><p className="text-sm font-medium text-amber-100">Sent invoice is frozen</p><p className="mt-1 text-xs leading-5 text-neutral-400">Void it in Stripe to preserve this snapshot, reopen the deal for edits, and send a new replacement invoice.</p></div>
                                <VoidInvoiceButton invoiceId={replaceableSale.stripe_invoice_id} alreadyVoided={replaceableSale.status === "invoice_inactive"} action={voidAndReopenRelationshipInvoice.bind(null, workspace.slug, relationship.id, replaceableSale.id)} />
                            </div> : null}
                            <form action={saveRelationshipCommercialDetails.bind(null, workspace.slug, relationship.id)} className="mt-3 grid gap-3 rounded-lg border border-neutral-800 p-3 text-sm sm:grid-cols-2">
                                <label className="grid gap-1 text-xs text-neutral-400">Seller<select name="seller_user_id" defaultValue={relationship.seller_user_id ?? user.id} className="h-9 rounded border border-neutral-700 bg-neutral-950 px-2 text-sm text-white"><option value="">Unassigned</option>{members.map((member) => <option key={member.user_id} value={member.user_id}>{member.username}</option>)}</select></label>
                                <label className="grid gap-1 text-xs text-neutral-400">Fulfilment manager<select name="fulfilment_manager_user_id" defaultValue={relationship.fulfilment_manager_user_id ?? ""} className="h-9 rounded border border-neutral-700 bg-neutral-950 px-2 text-sm text-white"><option value="">Choose before fulfilment</option>{members.map((member) => <option key={member.user_id} value={member.user_id}>{member.username}</option>)}</select></label>
                                <label className="grid gap-1 text-xs text-neutral-400">Project timeframe (days)<input name="project_timeframe_days" type="number" min="1" defaultValue={relationship.project_timeframe_days ?? ""} className="h-9 rounded border border-neutral-700 bg-neutral-950 px-2 text-sm text-white" /></label>
                                <label className="grid gap-1 text-xs text-neutral-400">WhatsApp phone<input name="whatsapp_phone" type="tel" defaultValue={relationship.whatsapp_phone ?? ""} placeholder="Needed for the onboarding link" className="h-9 rounded border border-neutral-700 bg-neutral-950 px-2 text-sm text-white" /></label>
                                <div className="sm:col-span-2">
                                    <div className="mb-2 flex items-center justify-between gap-3"><p className="text-xs font-medium text-neutral-300">Services and negotiated pricing</p>{!onboardingConfiguration.schemaReady ? <span className="text-[11px] text-yellow-300">Legacy catalogue fallback</span> : null}</div>
                                    <div className="space-y-2">{serviceOptions.map((service) => {
                                        const selected = service.selected
                                        const price = (Number(selected?.price_cents ?? service.defaultPriceCents) / 100).toFixed(2)
                                        const currency = String(selected?.currency ?? service.currency).toUpperCase()
                                        return <div key={service.code} className="grid gap-2 rounded-lg border border-neutral-800 bg-black/30 p-2 text-xs sm:grid-cols-[auto_minmax(0,1fr)_7rem_5rem_minmax(9rem,1fr)] sm:items-center">
                                            <input name="service_key" type="checkbox" value={service.code} defaultChecked={Boolean(selected)} aria-label={`Select ${service.name}`} />
                                            <span className="min-w-0"><span className="flex min-w-0 items-center gap-2"><span className="truncate text-neutral-200">{service.name}</span>{service.isTest ? <SquarePill tone="yellow">Test</SquarePill> : null}{selected && service.state !== "active" && service.state !== "legacy" ? <span className="shrink-0 text-[10px] capitalize text-yellow-300">Existing {service.state}</span> : null}</span><span className="mt-0.5 block truncate text-[11px] text-neutral-600">{service.revisionNumber ? `Revision ${service.revisionNumber} · ` : ""}{service.code}</span></span>
                                            <input name={`service_price_${service.code}`} type="number" min="0" step="0.01" defaultValue={price} aria-label={`${service.name} negotiated price`} className="h-8 rounded border border-neutral-700 bg-neutral-950 px-2 text-white" />
                                            <input name={`service_currency_${service.code}`} defaultValue={currency} maxLength={3} pattern="[A-Za-z]{3}" aria-label={`${service.name} currency`} className="h-8 rounded border border-neutral-700 bg-neutral-950 px-2 uppercase text-white" />
                                            <select name={`service_assignee_${service.code}`} defaultValue={selected?.assignee_user_id ?? service.defaultAssigneeId ?? ""} aria-label={`${service.name} assignee`} className="h-8 rounded border border-neutral-700 bg-neutral-950 px-2 text-white"><option value="">Unassigned</option>{members.map((member) => <option key={member.user_id} value={member.user_id}>{member.username}</option>)}</select>
                                            {service.serviceId ? <input type="hidden" name={`service_id_${service.code}`} value={service.serviceId} /> : null}
                                            {service.revisionId ? <input type="hidden" name={`service_revision_id_${service.code}`} value={service.revisionId} /> : null}
                                        </div>
                                    })}</div>
                                </div>
                                <button type="submit" className="h-9 justify-self-start rounded bg-white px-3 text-xs font-semibold text-neutral-950">Save workflow details</button>
                            </form>
                        </details> : null}

                        <section className="mt-5 flex flex-wrap gap-2 border-t border-neutral-900 pt-5 text-sm">
                            {isOnboarding && <Link href={onboardingDetailHref(workspace.slug, relationship.id)} className="rounded-lg border border-neutral-800 px-3 py-2 text-neutral-300 hover:text-white">Open onboarding detail</Link>}
                            {isFulfilment && <Link href={fulfilmentDetailHref(workspace.slug, relationship.id)} className="rounded-lg border border-neutral-800 px-3 py-2 text-neutral-300 hover:text-white">Open fulfilment detail</Link>}
                        </section>

                        {(role === "owner" || role === "admin") ? (
                            <section className="mt-8 border-t border-red-950/70 pt-5">
                                <h2 className="text-sm font-semibold text-red-300">Danger zone</h2>
                                <div className="mt-3 flex flex-col gap-4 rounded-lg border border-red-950/80 bg-red-950/10 p-4 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="max-w-2xl">
                                        <p className="text-sm font-medium text-neutral-200">Archive this relationship</p>
                                        <p className="mt-1 text-xs leading-5 text-neutral-500">
                                            Removes it from active relationship lists and WhatsApp confirmation matching while preserving its invoices, messages and other history.
                                        </p>
                                    </div>
                                    <ArchiveRelationshipForm
                                        action={archiveRelationship.bind(null, workspace.slug, relationship.id)}
                                        relationshipName={relationship.business_name ?? relationship.primary_person_name}
                                    />
                                </div>
                            </section>
                        ) : null}

                    </div>

                    <ClientContextPanel workspaceSlug={workspace.slug} relationship={relationship} />
                </div>
            </div>
        </main>
    )
}
