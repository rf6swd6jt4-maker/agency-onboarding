import Link from "next/link"
import { notFound } from "next/navigation"
import { RelationshipStage } from "@/components/ui"
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
import { SERVICES } from "@/lib/onboarding/services"
import { currentRelationshipWork, ensureCurrentRelationshipStage } from "@/lib/relationship-workflow"
import { saveRelationshipCommercialDetails } from "../actions"
import { RelationshipGantt } from "./RelationshipGantt"

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
    const [servicesResult, membershipsResult] = await Promise.all([
        supabaseAdmin.from("relationship_services").select("service_key, price_cents, assignee_user_id").eq("workspace_id", workspace.id).eq("relationship_id", relationship.id),
        supabaseAdmin.from("workspace_memberships").select("user_id").eq("workspace_id", workspace.id),
    ])
    const memberIds = (membershipsResult.data ?? []).map((member) => member.user_id)
    const profilesResult = memberIds.length ? await supabaseAdmin.from("user_profiles").select("user_id, username").in("user_id", memberIds).order("username") : { data: [] }
    const members = profilesResult.data ?? []
    const selectedServices = new Map((servicesResult.data ?? []).map((service) => [service.service_key, service]))
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
                            <form action={saveRelationshipCommercialDetails.bind(null, workspace.slug, relationship.id)} className="mt-3 grid gap-3 rounded-lg border border-neutral-800 p-3 text-sm sm:grid-cols-2">
                                <label className="grid gap-1 text-xs text-neutral-400">Seller<select name="seller_user_id" defaultValue={relationship.seller_user_id ?? user.id} className="h-9 rounded border border-neutral-700 bg-neutral-950 px-2 text-sm text-white"><option value="">Unassigned</option>{members.map((member) => <option key={member.user_id} value={member.user_id}>{member.username}</option>)}</select></label>
                                <label className="grid gap-1 text-xs text-neutral-400">Fulfilment manager<select name="fulfilment_manager_user_id" defaultValue={relationship.fulfilment_manager_user_id ?? ""} className="h-9 rounded border border-neutral-700 bg-neutral-950 px-2 text-sm text-white"><option value="">Choose before fulfilment</option>{members.map((member) => <option key={member.user_id} value={member.user_id}>{member.username}</option>)}</select></label>
                                <label className="grid gap-1 text-xs text-neutral-400">Project timeframe (days)<input name="project_timeframe_days" type="number" min="1" defaultValue={relationship.project_timeframe_days ?? ""} className="h-9 rounded border border-neutral-700 bg-neutral-950 px-2 text-sm text-white" /></label>
                                <label className="grid gap-1 text-xs text-neutral-400">WhatsApp phone<input name="whatsapp_phone" type="tel" defaultValue={relationship.whatsapp_phone ?? ""} placeholder="Needed for the onboarding link" className="h-9 rounded border border-neutral-700 bg-neutral-950 px-2 text-sm text-white" /></label>
                                <div className="sm:col-span-2 grid gap-2">{Object.entries(SERVICES).map(([key, service]) => { const selected = selectedServices.get(key); return <div key={key} className="grid grid-cols-[auto_minmax(0,1fr)_6rem_minmax(9rem,1fr)] items-center gap-2 text-xs"><input name="service_key" type="checkbox" value={key} defaultChecked={Boolean(selected)} /><span className="text-neutral-200">{service.title}</span><input name={`service_price_${key}`} type="number" min="0" step="0.01" defaultValue={selected?.price_cents ? (selected.price_cents / 100).toFixed(2) : ""} placeholder="Price" className="h-8 rounded border border-neutral-700 bg-neutral-950 px-2 text-white" /><select name={`service_assignee_${key}`} defaultValue={selected?.assignee_user_id ?? ""} className="h-8 rounded border border-neutral-700 bg-neutral-950 px-2 text-white"><option value="">Unassigned</option>{members.map((member) => <option key={member.user_id} value={member.user_id}>{member.username}</option>)}</select></div> })}</div>
                                <button type="submit" className="h-9 justify-self-start rounded bg-white px-3 text-xs font-semibold text-neutral-950">Save workflow details</button>
                            </form>
                        </details> : null}

                        <section className="mt-5 flex flex-wrap gap-2 border-t border-neutral-900 pt-5 text-sm">
                            {isOnboarding && <Link href={onboardingDetailHref(workspace.slug, relationship.id)} className="rounded-lg border border-neutral-800 px-3 py-2 text-neutral-300 hover:text-white">Open onboarding detail</Link>}
                            {isFulfilment && <Link href={fulfilmentDetailHref(workspace.slug, relationship.id)} className="rounded-lg border border-neutral-800 px-3 py-2 text-neutral-300 hover:text-white">Open fulfilment detail</Link>}
                        </section>

                    </div>

                    <ClientContextPanel workspaceSlug={workspace.slug} relationship={relationship} />
                </div>
            </div>
        </main>
    )
}
