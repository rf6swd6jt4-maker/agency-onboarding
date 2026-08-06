"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import type { WorkspaceCreateActionState } from "@/app/[workspaceSlug]/relationships/actions"
import { recordAdminActivity } from "@/lib/admin/activity"
import { platformFailureFingerprint, reportPlatformFailure } from "@/lib/admin/maintenance"
import type { OkrReportingCadence } from "@/lib/admin/okr-reporting"
import { okrDisplayTitle } from "@/lib/admin/okr-title"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

function value(formData: FormData, key: string) {
    return String(formData.get(key) ?? "").trim()
}

function numericValue(formData: FormData, key: string) {
    const result = Number(value(formData, key))
    if (!Number.isFinite(result)) throw new Error(`Invalid ${key}`)
    return result
}

function reportingCadence(formData: FormData): OkrReportingCadence {
    const cadence = value(formData, "reporting_cadence")
    if (cadence !== "daily" && cadence !== "weekly" && cadence !== "manual") throw new Error("Choose a reporting cadence")
    return cadence
}

function adminPath(slug: string, suffix = "") {
    return `/${slug}/admin${suffix}`
}

function okrsHref(slug: string, anchor = "") {
    return `/${slug}/admin?view=okrs${anchor ? `#${anchor}` : ""}`
}

async function requireAdminUser(workspaceId: string, userId: string) {
    const { data } = await supabaseAdmin.from("workspace_memberships").select("role").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle()
    if (!data || !["owner", "admin"].includes(data.role)) throw new Error("Choose a workspace owner or admin")
}

async function requireDraftOkr(workspaceId: string, okrId: string) {
    const { data } = await supabaseAdmin.from("workspace_okrs").select("id, status, owner_user_id").eq("workspace_id", workspaceId).eq("id", okrId).maybeSingle()
    if (!data) throw new Error("OKR not found")
    if (data.status !== "draft") throw new Error("Committed OKRs cannot be edited")
    return data
}

async function requireCommittedOkr(workspaceId: string, okrId: string) {
    const { data } = await supabaseAdmin.from("workspace_okrs").select("id, status, owner_user_id, objective_type").eq("workspace_id", workspaceId).eq("id", okrId).maybeSingle()
    if (!data || data.status !== "active" || data.objective_type !== "committed") throw new Error("Work can only be added to a committed OKR")
    return data
}

export async function createOkrFromModal(slug: string, formData: FormData): Promise<WorkspaceCreateActionState> {
    const { workspace, user } = await requireWorkspace(slug, "admin")
    const objective = value(formData, "objective")
    const periodStart = value(formData, "period_start")
    const periodEnd = value(formData, "period_end")
    const ownerUserId = value(formData, "owner_user_id") || user.id
    const isTest = value(formData, "is_test") === "true"
    const sourceHref = `/${workspace.slug}/admin?view=okrs`
    if (!objective || !/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) || periodEnd < periodStart) {
        await recordAdminActivity({ workspaceId: workspace.id, category: "system", level: "warning", eventKey: "okr.create.validation_failed", summary: "An administrator could not create an OKR because its objective period was invalid", sourceHref, actorUserId: user.id })
        return { ok: false, error: "Add an objective, a valid start date, and a valid deadline." }
    }
    try {
        await requireAdminUser(workspace.id, ownerUserId)
    } catch {
        await recordAdminActivity({ workspaceId: workspace.id, category: "system", level: "warning", eventKey: "okr.create.owner_invalid", summary: "An administrator could not create an OKR because its owner was invalid", sourceHref, actorUserId: user.id })
        return { ok: false, error: "Choose a workspace owner or admin." }
    }
    const { data: okr, error } = await supabaseAdmin.from("workspace_okrs").insert({
        workspace_id: workspace.id,
        objective,
        objective_type: null,
        is_test: isTest,
        description: value(formData, "description") || null,
        period_start: periodStart,
        period_end: periodEnd,
        owner_user_id: ownerUserId,
        status: "draft",
        created_by: user.id,
    }).select("id").single()
    if (error || !okr) {
        const message = error?.message ?? "No OKR was returned after creation"
        await reportPlatformFailure({
            workspaceId: workspace.id,
            category: "system_health",
            source: "admin_okr",
            operation: "create",
            fingerprint: platformFailureFingerprint(["okr", "create", error?.code ?? message]),
            severity: "warning",
            summary: "An administrator could not create an OKR",
            diagnostics: { error: message, code: error?.code ?? null, objective, status: "draft" },
            sourceHref,
        })
        return { ok: false, error: "We couldn't create this OKR. The failure has been recorded for Admin review." }
    }
    const displayTitle = okrDisplayTitle({ objectiveType: null, objective, deadline: periodEnd })
    await recordAdminActivity({ workspaceId: workspace.id, category: "system", eventKey: "okr.created", summary: `OKR draft created: ${displayTitle}`, entityType: "okr", entityId: okr.id, sourceHref: okrsHref(workspace.slug, `okr-${okr.id}`), actorUserId: user.id, metadata: { objective_type: null, is_test: isTest, status: "draft", period_start: periodStart, period_end: periodEnd, owner_user_id: ownerUserId } })
    revalidatePath(adminPath(slug))
    return { ok: true, href: okrsHref(slug, `okr-${okr.id}`) }
}

export async function createOkr(slug: string, formData: FormData) {
    const result = await createOkrFromModal(slug, formData)
    if (!result.ok) redirect(adminPath(slug, `?view=okrs&error=${encodeURIComponent(result.error ?? "create-failed")}`))
    redirect(result.href ?? adminPath(slug, "?view=okrs"))
}

export async function updateOkr(slug: string, okrId: string, formData: FormData) {
    const { workspace } = await requireWorkspace(slug, "admin")
    await requireDraftOkr(workspace.id, okrId)
    const objective = value(formData, "objective")
    const periodStart = value(formData, "period_start")
    const periodEnd = value(formData, "period_end")
    const ownerUserId = value(formData, "owner_user_id")
    if (!objective || periodEnd < periodStart) throw new Error("Add a valid objective and period")
    await requireAdminUser(workspace.id, ownerUserId)
    const { error } = await supabaseAdmin.from("workspace_okrs").update({ objective, description: value(formData, "description") || null, period_start: periodStart, period_end: periodEnd, owner_user_id: ownerUserId }).eq("workspace_id", workspace.id).eq("id", okrId).eq("status", "draft")
    if (error) throw new Error(error.message)
    revalidatePath(adminPath(slug)); revalidatePath(adminPath(slug, `/okrs/${okrId}`))
}

export async function updateActiveOkrDetails(slug: string, okrId: string, formData: FormData) {
    const { workspace } = await requireWorkspace(slug, "admin")
    await requireCommittedOkr(workspace.id, okrId)
    const ownerUserId = value(formData, "owner_user_id")
    await requireAdminUser(workspace.id, ownerUserId)
    const { error } = await supabaseAdmin.from("workspace_okrs").update({ owner_user_id: ownerUserId, description: value(formData, "description") || null }).eq("workspace_id", workspace.id).eq("id", okrId).eq("status", "active")
    if (error) throw new Error(error.message)
    revalidatePath(adminPath(slug))
}

export async function commitOkr(slug: string, okrId: string) {
    const { workspace, user } = await requireWorkspace(slug, "admin")
    await requireDraftOkr(workspace.id, okrId)
    const { data: keyResults } = await supabaseAdmin.from("workspace_okr_key_results").select("id, reporting_cadence").eq("workspace_id", workspace.id).eq("okr_id", okrId)
    if (!keyResults?.length) throw new Error("Add at least one Key Result before committing")
    if (keyResults.some((result) => !result.reporting_cadence)) throw new Error("Choose a reporting cadence for every Key Result before committing")
    const { error } = await supabaseAdmin.from("workspace_okrs").update({ status: "active", objective_type: "committed" }).eq("workspace_id", workspace.id).eq("id", okrId).eq("status", "draft")
    if (error) throw new Error(error.message)
    await recordAdminActivity({ workspaceId: workspace.id, category: "system", eventKey: "okr.committed", summary: "An OKR was committed and its definition locked", entityType: "okr", entityId: okrId, sourceHref: okrsHref(workspace.slug, `okr-${okrId}`), actorUserId: user.id, metadata: { objective_type: "committed", status: "active" } })
    revalidatePath(adminPath(slug)); revalidatePath(adminPath(slug, `/okrs/${okrId}`))
}

export async function deleteOkr(slug: string, okrId: string) {
    const { workspace } = await requireWorkspace(slug, "admin")
    await requireDraftOkr(workspace.id, okrId)
    const { error } = await supabaseAdmin.from("workspace_okrs").delete().eq("workspace_id", workspace.id).eq("id", okrId)
    if (error) throw new Error(error.message)
    revalidatePath(adminPath(slug))
    redirect(adminPath(slug, "?view=okrs"))
}

export async function setOkrStatus(slug: string, okrId: string, status: "draft" | "active" | "completed" | "cancelled", formData?: FormData) {
    const { workspace } = await requireWorkspace(slug, "admin")
    if (status === "draft" || status === "active") throw new Error("Use Commit to activate a draft OKR")
    await requireCommittedOkr(workspace.id, okrId)
    const outcomeNote = formData ? value(formData, "outcome_note") : ""
    if (status === "completed" && !outcomeNote) throw new Error("Record an outcome note before completing the OKR")
    const { error } = await supabaseAdmin.from("workspace_okrs").update({ status, outcome_note: status === "completed" || status === "cancelled" ? outcomeNote || null : null }).eq("workspace_id", workspace.id).eq("id", okrId)
    if (error) throw new Error(error.message)
    revalidatePath(adminPath(slug)); revalidatePath(adminPath(slug, `/okrs/${okrId}`))
}

export async function addOkrKeyResult(slug: string, okrId: string, formData: FormData) {
    const { workspace } = await requireWorkspace(slug, "admin")
    await requireDraftOkr(workspace.id, okrId)
    const unit = value(formData, "unit")
    const comparator = value(formData, "comparator")
    const name = value(formData, "name")
    if (!name) throw new Error("Add a Key Result name")
    const { count } = await supabaseAdmin.from("workspace_okr_key_results").select("id", { count: "exact", head: true }).eq("okr_id", okrId)
    const { error } = await supabaseAdmin.from("workspace_okr_key_results").insert({
        workspace_id: workspace.id,
        okr_id: okrId,
        name,
        description: value(formData, "description") || null,
        unit: ["number", "percentage", "currency", "duration"].includes(unit) ? unit : "number",
        currency_code: unit === "currency" ? (value(formData, "currency_code") || "USD").toUpperCase() : null,
        comparator: comparator === "at_most" ? "at_most" : "at_least",
        baseline_value: numericValue(formData, "baseline_value"),
        target_value: numericValue(formData, "target_value"),
        reporting_cadence: reportingCadence(formData),
        sort_order: count ?? 0,
    })
    if (error) throw new Error(error.message)
    revalidatePath(adminPath(slug)); revalidatePath(adminPath(slug, `/okrs/${okrId}`))
}

export async function deleteOkrKeyResult(slug: string, okrId: string, keyResultId: string) {
    const { workspace } = await requireWorkspace(slug, "admin")
    await requireDraftOkr(workspace.id, okrId)
    const { error } = await supabaseAdmin.from("workspace_okr_key_results").delete().eq("workspace_id", workspace.id).eq("okr_id", okrId).eq("id", keyResultId)
    if (error) throw new Error(error.message)
    revalidatePath(adminPath(slug)); revalidatePath(adminPath(slug, `/okrs/${okrId}`))
}

export async function updateOkrKeyResult(slug: string, okrId: string, keyResultId: string, formData: FormData) {
    const { workspace } = await requireWorkspace(slug, "admin")
    await requireDraftOkr(workspace.id, okrId)
    const name = value(formData, "name")
    const unit = value(formData, "unit")
    const comparator = value(formData, "comparator")
    if (!name) throw new Error("Add a Key Result name")
    const { error } = await supabaseAdmin.from("workspace_okr_key_results").update({
        name,
        description: value(formData, "description") || null,
        unit: ["number", "percentage", "currency", "duration"].includes(unit) ? unit : "number",
        currency_code: unit === "currency" ? (value(formData, "currency_code") || "USD").toUpperCase() : null,
        comparator: comparator === "at_most" ? "at_most" : "at_least",
        baseline_value: numericValue(formData, "baseline_value"),
        target_value: numericValue(formData, "target_value"),
        reporting_cadence: reportingCadence(formData),
    }).eq("workspace_id", workspace.id).eq("okr_id", okrId).eq("id", keyResultId)
    if (error) throw new Error(error.message)
    revalidatePath(adminPath(slug)); revalidatePath(adminPath(slug, `/okrs/${okrId}`))
}

export async function updateActiveOkrKeyResultDescription(slug: string, okrId: string, keyResultId: string, formData: FormData) {
    const { workspace } = await requireWorkspace(slug, "admin")
    await requireCommittedOkr(workspace.id, okrId)
    const { error } = await supabaseAdmin.from("workspace_okr_key_results").update({ description: value(formData, "description") || null }).eq("workspace_id", workspace.id).eq("okr_id", okrId).eq("id", keyResultId)
    if (error) throw new Error(error.message)
    revalidatePath(adminPath(slug))
}

export async function setOkrKeyResultCadence(slug: string, okrId: string, keyResultId: string, formData: FormData) {
    const { workspace } = await requireWorkspace(slug, "admin")
    await requireCommittedOkr(workspace.id, okrId)
    const { data: keyResult } = await supabaseAdmin.from("workspace_okr_key_results").select("reporting_cadence").eq("workspace_id", workspace.id).eq("okr_id", okrId).eq("id", keyResultId).maybeSingle()
    if (!keyResult) throw new Error("Key Result not found")
    if (keyResult.reporting_cadence) throw new Error("Reporting cadence was already set")
    const { data: updated, error } = await supabaseAdmin.from("workspace_okr_key_results").update({ reporting_cadence: reportingCadence(formData) }).eq("workspace_id", workspace.id).eq("okr_id", okrId).eq("id", keyResultId).is("reporting_cadence", null).select("id").maybeSingle()
    if (error || !updated) throw new Error(error?.message ?? "Reporting cadence was already set")
    revalidatePath(adminPath(slug))
}

export async function addOkrMeasurement(slug: string, okrId: string, keyResultId: string, formData: FormData) {
    const { workspace, user } = await requireWorkspace(slug, "admin")
    await requireCommittedOkr(workspace.id, okrId)
    const reportedOn = value(formData, "reported_on")
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportedOn) || Number.isNaN(Date.parse(`${reportedOn}T00:00:00.000Z`))) throw new Error("Add a valid report date")
    if (reportedOn > new Date().toISOString().slice(0, 10)) throw new Error("Report date cannot be in the future")
    const { data: keyResult } = await supabaseAdmin.from("workspace_okr_key_results").select("id").eq("workspace_id", workspace.id).eq("okr_id", okrId).eq("id", keyResultId).maybeSingle()
    if (!keyResult) throw new Error("Key Result not found")
    const { error } = await supabaseAdmin.from("workspace_okr_measurements").insert({ workspace_id: workspace.id, key_result_id: keyResultId, value: numericValue(formData, "value"), reported_on: reportedOn, measured_at: new Date().toISOString(), note: value(formData, "note") || null, provenance: "manual", recorded_by: user.id })
    if (error) throw new Error(error.message)
    revalidatePath(adminPath(slug)); revalidatePath(adminPath(slug, `/okrs/${okrId}`))
}

export async function createOkrAction(slug: string, okrId: string, keyResultId: string, formData: FormData) {
    const { workspace, user } = await requireWorkspace(slug, "admin")
    const okr = await requireCommittedOkr(workspace.id, okrId)
    const { data: keyResult } = await supabaseAdmin.from("workspace_okr_key_results").select("id").eq("workspace_id", workspace.id).eq("okr_id", okrId).eq("id", keyResultId).maybeSingle()
    if (!okr || !keyResult || !value(formData, "title")) throw new Error("Add a valid OKR action")
    const title = value(formData, "title")
    const description = value(formData, "description")
    const { data: item, error } = await supabaseAdmin.from("work_items").insert({ workspace_id: workspace.id, title, description: `Admin work: ${description || title}`, lifecycle_phase: null, status: "todo", priority: 3, is_key_task: true, area: "admin", kind: "okr_action", visibility: "admins_only", native_kind: "okr_action", created_by: user.id, metadata: { okr_id: okrId, key_result_id: keyResultId } }).select("id").single()
    if (error || !item) throw new Error(error?.message ?? "Could not create action")
    const { error: linkError } = await supabaseAdmin.from("workspace_okr_work_items").insert({ workspace_id: workspace.id, key_result_id: keyResultId, work_item_id: item.id, linked_by: user.id })
    if (linkError) {
        await supabaseAdmin.from("work_items").delete().eq("workspace_id", workspace.id).eq("id", item.id)
        throw new Error(linkError.message)
    }
    const { error: assigneeError } = await supabaseAdmin.from("work_item_assignees").insert({ workspace_id: workspace.id, work_item_id: item.id, user_id: okr.owner_user_id, assigned_by: user.id })
    if (assigneeError) {
        await supabaseAdmin.from("work_items").delete().eq("workspace_id", workspace.id).eq("id", item.id)
        throw new Error(assigneeError.message)
    }
    revalidatePath(adminPath(slug)); revalidatePath(adminPath(slug, `/okrs/${okrId}`))
}

export async function linkOkrAction(slug: string, okrId: string, keyResultId: string, formData: FormData) {
    const { workspace, user } = await requireWorkspace(slug, "admin")
    await requireCommittedOkr(workspace.id, okrId)
    const workItemId = value(formData, "work_item_id")
    const [{ data: keyResult }, { data: item }] = await Promise.all([
        supabaseAdmin.from("workspace_okr_key_results").select("id").eq("workspace_id", workspace.id).eq("okr_id", okrId).eq("id", keyResultId).maybeSingle(),
        supabaseAdmin.from("work_items").select("id").eq("workspace_id", workspace.id).eq("id", workItemId).maybeSingle(),
    ])
    if (!keyResult || !item) throw new Error("Choose a work item from this workspace")
    const { error } = await supabaseAdmin.from("workspace_okr_work_items").upsert({ workspace_id: workspace.id, key_result_id: keyResultId, work_item_id: workItemId, linked_by: user.id })
    if (error) throw new Error(error.message)
    revalidatePath(adminPath(slug)); revalidatePath(adminPath(slug, `/okrs/${okrId}`))
}

export async function unlinkOkrAction(slug: string, okrId: string, keyResultId: string, workItemId: string) {
    const { workspace } = await requireWorkspace(slug, "admin")
    await requireCommittedOkr(workspace.id, okrId)
    const { error } = await supabaseAdmin.from("workspace_okr_work_items").delete().eq("workspace_id", workspace.id).eq("key_result_id", keyResultId).eq("work_item_id", workItemId)
    if (error) throw new Error(error.message)
    revalidatePath(adminPath(slug)); revalidatePath(adminPath(slug, `/okrs/${okrId}`))
}
