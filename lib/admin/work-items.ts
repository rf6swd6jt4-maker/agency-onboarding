import { supabaseAdmin } from "@/lib/supabase/admin"

export type AdminWorkItem = {
    id: string
    title: string
    description: string | null
    status: string
    priority: number
    kind: "okr_action" | "maintenance" | "standard"
    updated_at: string
    assignee_ids: string[]
}

export async function listAdminWorkItems(workspaceId: string): Promise<AdminWorkItem[]> {
    const { data: items, error } = await supabaseAdmin.from("work_items")
        .select("id, title, description, status, priority, kind, updated_at")
        .eq("workspace_id", workspaceId)
        .eq("area", "admin")
        .eq("visibility", "admins_only")
        .order("updated_at", { ascending: false })
        .limit(200)
    if (error || !items?.length) return []
    const { data: assignees } = await supabaseAdmin.from("work_item_assignees")
        .select("work_item_id, user_id")
        .eq("workspace_id", workspaceId)
        .in("work_item_id", items.map((item) => item.id))
    const assigneesByItem = new Map<string, string[]>()
    for (const row of assignees ?? []) assigneesByItem.set(row.work_item_id, [...(assigneesByItem.get(row.work_item_id) ?? []), row.user_id])
    return items.map((item) => ({
        ...item,
        kind: item.kind === "maintenance" || item.kind === "okr_action" ? item.kind : "standard",
        assignee_ids: assigneesByItem.get(item.id) ?? [],
    })) as AdminWorkItem[]
}
