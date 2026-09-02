import { MAINTENANCE_CATEGORIES } from "@/lib/admin/maintenance"
import { loadWorkspaceTeams } from "@/lib/teams/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function ids(value: unknown) {
    return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && UUID_PATTERN.test(item)))] : []
}

function assignments(value: unknown, key: "serviceId" | "category") {
    if (!Array.isArray(value)) return []
    return value.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return []
        const row = item as Record<string, unknown>
        const subject = typeof row[key] === "string" ? row[key] as string : ""
        const userId = typeof row.userId === "string" ? row.userId : ""
        return subject && UUID_PATTERN.test(userId) ? [{ subject, userId }] : []
    })
}

async function response(workspaceId: string) {
    return Response.json(await loadWorkspaceTeams(workspaceId), { headers: { "Cache-Control": "no-store" } })
}

export async function GET(_: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace } = await requireWorkspace(workspaceSlug, "admin")
    return response(workspace.id)
}

export async function POST(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user, role } = await requireWorkspace(workspaceSlug, "admin")
    const input = await request.json().catch(() => null) as Record<string, unknown> | null
    const action = typeof input?.action === "string" ? input.action : ""
    const teamId = typeof input?.teamId === "string" ? input.teamId : ""
    const memberIds = ids(input?.memberIds)
    const serviceAssignments = [...new Map(assignments(input?.responsibilities, "serviceId").map((assignment) => [assignment.subject, assignment])).values()]
    const maintenanceAssignments = [...new Map(assignments(input?.maintenanceResponsibilities, "category").map((assignment) => [assignment.subject, assignment])).values()]

    if (action === "archive") {
        if (!UUID_PATTERN.test(teamId)) return Response.json({ error: "Team not found." }, { status: 404 })
        const { data: team, error: teamError } = await supabaseAdmin.from("workspace_teams").select("id, kind").eq("workspace_id", workspace.id).eq("id", teamId).maybeSingle()
        if (teamError || !team) return Response.json({ error: "Team not found." }, { status: 404 })
        if (team.kind !== "custom") return Response.json({ error: "Required teams cannot be archived." }, { status: 409 })
        const { error } = await supabaseAdmin.from("workspace_teams").update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("workspace_id", workspace.id).eq("id", teamId)
        if (error) return Response.json({ error: error.message }, { status: 503 })
        return response(workspace.id)
    }

    const [{ data: memberships, error: membershipError }, { data: supportedServices, error: servicesError }] = await Promise.all([
        supabaseAdmin.from("workspace_memberships").select("user_id").eq("workspace_id", workspace.id),
        supabaseAdmin.from("onboarding_services").select("id").eq("workspace_id", workspace.id).eq("state", "active"),
    ])
    if (membershipError || servicesError) return Response.json({ error: membershipError?.message ?? servicesError?.message ?? "Could not load team options." }, { status: 503 })
    const workspaceMemberIds = new Set((memberships ?? []).map((membership) => membership.user_id))
    const supportedServiceIds = new Set((supportedServices ?? []).map((service) => service.id))
    if (!memberIds.length || memberIds.some((id) => !workspaceMemberIds.has(id))) return Response.json({ error: "Choose at least one current workspace member." }, { status: 400 })
    if ([...serviceAssignments, ...maintenanceAssignments].some((assignment) => !memberIds.includes(assignment.userId))) return Response.json({ error: "Every responsibility must belong to a selected team member." }, { status: 400 })
    if (serviceAssignments.some((assignment) => !supportedServiceIds.has(assignment.subject))) return Response.json({ error: "A service is no longer active. Reload and review the team." }, { status: 409 })
    if (maintenanceAssignments.some((assignment) => !MAINTENANCE_CATEGORIES.includes(assignment.subject as (typeof MAINTENANCE_CATEGORIES)[number]))) return Response.json({ error: "Unknown maintenance category." }, { status: 400 })

    if (action === "create") {
        if ([...supportedServiceIds].some((serviceId) => !serviceAssignments.some((assignment) => assignment.subject === serviceId))) return Response.json({ error: "Assign every active service before creating the fulfilment team." }, { status: 400 })
        const name = typeof input?.name === "string" ? input.name.trim().replace(/\s+/g, " ") : ""
        if (name.length < 2 || name.length > 80 || ["admins", "maintenance"].includes(name.toLowerCase())) return Response.json({ error: "Choose a team name between 2 and 80 characters." }, { status: 400 })
        const { data: team, error } = await supabaseAdmin.from("workspace_teams").insert({ workspace_id: workspace.id, name, kind: "custom", created_by: user.id }).select("id").single()
        if (error || !team) return Response.json({ error: error?.code === "23505" ? "An active team already uses that name." : error?.message ?? "Could not create team." }, { status: error?.code === "23505" ? 409 : 503 })
        const memberResult = await supabaseAdmin.from("workspace_team_members").insert(memberIds.map((memberId) => ({ workspace_id: workspace.id, team_id: team.id, user_id: memberId, added_by: user.id })))
        const responsibilityResult = serviceAssignments.length ? await supabaseAdmin.from("workspace_team_service_responsibilities").insert(serviceAssignments.map((assignment) => ({ workspace_id: workspace.id, team_id: team.id, service_id: assignment.subject, responsible_user_id: assignment.userId, updated_by: user.id }))) : { error: null }
        if (memberResult.error || responsibilityResult.error) {
            await supabaseAdmin.from("workspace_teams").delete().eq("workspace_id", workspace.id).eq("id", team.id)
            return Response.json({ error: memberResult.error?.message ?? responsibilityResult.error?.message ?? "Could not finish creating team." }, { status: 503 })
        }
        return response(workspace.id)
    }

    if (!UUID_PATTERN.test(teamId)) return Response.json({ error: "Team not found." }, { status: 404 })
    const { data: team, error: teamError } = await supabaseAdmin.from("workspace_teams").select("id, name, kind, archived_at").eq("workspace_id", workspace.id).eq("id", teamId).maybeSingle()
    if (teamError || !team) return Response.json({ error: "Team not found." }, { status: 404 })
    if (team.kind === "admins") return Response.json({ error: "Admins membership follows Settings > Users." }, { status: 409 })
    if (team.kind === "maintenance" && role !== "owner") return Response.json({ error: "Only the workspace owner can edit Maintenance." }, { status: 403 })

    if (action !== "update" || team.archived_at) return Response.json({ error: "This team is read-only." }, { status: 409 })

    if (team.kind === "maintenance") {
        const byCategory = new Map(maintenanceAssignments.map((assignment) => [assignment.subject, assignment.userId]))
        if (MAINTENANCE_CATEGORIES.some((category) => !byCategory.has(category))) return Response.json({ error: "Assign every maintenance category before saving." }, { status: 400 })
    } else if (team.kind === "custom" && [...supportedServiceIds].some((serviceId) => !serviceAssignments.some((assignment) => assignment.subject === serviceId))) {
        return Response.json({ error: "Assign every active service before saving the fulfilment team." }, { status: 400 })
    }
    const requestedName = team.kind === "custom" && typeof input?.name === "string" ? input.name.trim().replace(/\s+/g, " ") : team.name
    if (requestedName.length < 2 || requestedName.length > 80) return Response.json({ error: "Choose a team name between 2 and 80 characters." }, { status: 400 })

    const { data: currentMembers } = await supabaseAdmin.from("workspace_team_members").select("user_id").eq("workspace_id", workspace.id).eq("team_id", teamId)
    const currentIds = (currentMembers ?? []).map((member) => member.user_id)
    const adding = memberIds.filter((id) => !currentIds.includes(id))
    const removing = currentIds.filter((id) => !memberIds.includes(id))
    if (removing.length && team.kind === "custom") {
        const { data: mapped } = await supabaseAdmin.from("workspace_team_service_responsibilities").select("service_id, responsible_user_id").eq("workspace_id", workspace.id).eq("team_id", teamId).in("responsible_user_id", removing)
        const submitted = new Map(serviceAssignments.map((assignment) => [assignment.subject, assignment.userId]))
        if ((mapped ?? []).some((item) => !submitted.has(item.service_id) || removing.includes(submitted.get(item.service_id)!))) return Response.json({ error: "Reassign this member's service responsibilities before removing them." }, { status: 409 })
    }
    if (removing.length && team.kind === "maintenance") {
        const { data: mapped } = await supabaseAdmin.from("workspace_maintenance_routing").select("category, responsible_user_id").eq("workspace_id", workspace.id).in("responsible_user_id", removing)
        const submitted = new Map(maintenanceAssignments.map((assignment) => [assignment.subject, assignment.userId]))
        if ((mapped ?? []).some((item) => !submitted.has(item.category) || removing.includes(submitted.get(item.category)!))) return Response.json({ error: "Reassign this member's maintenance categories before removing them." }, { status: 409 })
    }
    if (adding.length) {
        const { error } = await supabaseAdmin.from("workspace_team_members").insert(adding.map((memberId) => ({ workspace_id: workspace.id, team_id: teamId, user_id: memberId, added_by: user.id })))
        if (error) return Response.json({ error: error.message }, { status: 503 })
    }
    if (team.kind === "custom") {
        const { error: nameError } = await supabaseAdmin.from("workspace_teams").update({ name: requestedName, updated_at: new Date().toISOString() }).eq("workspace_id", workspace.id).eq("id", teamId)
        if (nameError) return Response.json({ error: nameError.code === "23505" ? "An active team already uses that name." : nameError.message }, { status: nameError.code === "23505" ? 409 : 503 })
        const serviceIds = serviceAssignments.map((assignment) => assignment.subject)
        if (serviceAssignments.length) {
            const { error } = await supabaseAdmin.from("workspace_team_service_responsibilities").upsert(serviceAssignments.map((assignment) => ({ workspace_id: workspace.id, team_id: teamId, service_id: assignment.subject, responsible_user_id: assignment.userId, updated_by: user.id, updated_at: new Date().toISOString() })), { onConflict: "team_id,service_id" })
            if (error) return Response.json({ error: error.message }, { status: 503 })
        }
        const { data: existingResponsibilities } = await supabaseAdmin.from("workspace_team_service_responsibilities").select("service_id").eq("workspace_id", workspace.id).eq("team_id", teamId)
        const stale = (existingResponsibilities ?? []).map((item) => item.service_id).filter((id) => !serviceIds.includes(id))
        if (stale.length) await supabaseAdmin.from("workspace_team_service_responsibilities").delete().eq("workspace_id", workspace.id).eq("team_id", teamId).in("service_id", stale)
    } else {
        const { error } = await supabaseAdmin.from("workspace_maintenance_routing").upsert(maintenanceAssignments.map((assignment) => ({ workspace_id: workspace.id, category: assignment.subject, responsible_user_id: assignment.userId, updated_by: user.id, updated_at: new Date().toISOString() })), { onConflict: "workspace_id,category" })
        if (error) return Response.json({ error: error.message }, { status: 503 })
        await supabaseAdmin.from("workspace_maintenance_routing").delete().eq("workspace_id", workspace.id).eq("category", "global")
    }
    if (removing.length) {
        const { error } = await supabaseAdmin.from("workspace_team_members").delete().eq("workspace_id", workspace.id).eq("team_id", teamId).in("user_id", removing)
        if (error) return Response.json({ error: "Reassign this member's responsibilities before removing them." }, { status: 409 })
    }
    return response(workspace.id)
}
