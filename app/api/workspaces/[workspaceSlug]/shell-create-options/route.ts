import { accessibleRelationshipIds, accessibleWorkItemIds, requireWorkspaceAccess } from "@/lib/workspace-access"
import { supabaseAdmin } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

export async function GET(_request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user, role, access } = await requireWorkspaceAccess(workspaceSlug)
    if (role !== "owner" && role !== "admin") return Response.json({ error: "Not authorized" }, { status: 403 })

    const relationshipIds = await accessibleRelationshipIds(access)
    const workItemIds = await accessibleWorkItemIds(access, relationshipIds)
    let workItemsQuery = supabaseAdmin.from("work_items").select("id, title, status").eq("workspace_id", workspace.id).eq("visibility", "workspace").order("title").limit(200)
    let relationshipsQuery = supabaseAdmin.from("relationships").select("id, primary_person_name, business_name").eq("workspace_id", workspace.id).order("updated_at", { ascending: false }).limit(200)
    if (workItemIds) workItemsQuery = workItemIds.size ? workItemsQuery.in("id", [...workItemIds]) : workItemsQuery.eq("id", "00000000-0000-0000-0000-000000000000")
    if (relationshipIds) relationshipsQuery = relationshipIds.size ? relationshipsQuery.in("id", [...relationshipIds]) : relationshipsQuery.eq("id", "00000000-0000-0000-0000-000000000000")
    const [{ data: workItems }, { data: relationships }, { data: adminMemberships }] = await Promise.all([
        workItemsQuery,
        relationshipsQuery,
        supabaseAdmin.from("workspace_memberships").select("user_id, role").eq("workspace_id", workspace.id).in("role", ["owner", "admin"]).order("created_at"),
    ])
    const adminIds = (adminMemberships ?? []).map((item) => item.user_id)
    const { data: adminProfiles } = adminIds.length
        ? await supabaseAdmin.from("user_profiles").select("user_id, username").in("user_id", adminIds)
        : { data: [] }
    const adminNames = new Map((adminProfiles ?? []).map((item) => [item.user_id, item.username]))

    return Response.json({
        workItemOptions: (workItems ?? []).map((item) => ({ id: item.id, title: item.title, status: item.status })),
        relationshipOptions: (relationships ?? []).map((relationship) => ({ id: relationship.id, label: relationship.business_name ?? relationship.primary_person_name ?? "Relationship" })),
        okrOwnerOptions: (adminMemberships ?? []).map((item) => ({ id: item.user_id, label: adminNames.get(item.user_id) ?? (item.user_id === user.id ? "Account" : item.role), role: item.role })),
    }, { headers: { "Cache-Control": "private, no-store" } })
}
