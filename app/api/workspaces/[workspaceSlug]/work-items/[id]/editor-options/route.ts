import { listActiveWorkspaceKeyResults } from "@/lib/admin/okrs"
import { getWorkItem, listRelationshipsForWorkspace, listWorkItemEditorCandidates } from "@/lib/relationships"
import { shortId } from "@/lib/ui/relative-time"
import { accessibleRelationshipIds, accessibleWorkItemIds, requireWorkspaceAccess, workspaceAccessHasCapability } from "@/lib/workspace-access"

export const dynamic = "force-dynamic"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function GET(_: Request, context: { params: Promise<{ workspaceSlug: string; id: string }> }) {
    const { workspaceSlug, id } = await context.params
    if (!UUID_PATTERN.test(id)) return Response.json({ error: "Work item not found." }, { status: 404 })

    const { workspace, role, access } = await requireWorkspaceAccess(workspaceSlug)
    if (!workspaceAccessHasCapability(access, "fulfilment.manage") && !workspaceAccessHasCapability(access, "onboarding.manage")) {
        return Response.json({ error: "Work item not found." }, { status: 404 })
    }

    const [item, allowedRelationshipIds, allowedWorkItemIds] = await Promise.all([
        getWorkItem(workspace.id, id),
        accessibleRelationshipIds(access),
        accessibleWorkItemIds(access),
    ])
    if (!item || (allowedWorkItemIds && !allowedWorkItemIds.has(id)) || (item.visibility === "admins_only" && role === "staff")) {
        return Response.json({ error: "Work item not found." }, { status: 404 })
    }

    const isAdminItem = item.area === "admin"
    const [workItems, relationships, keyResults] = await Promise.all([
        listWorkItemEditorCandidates(workspace.id, item),
        isAdminItem ? Promise.resolve([]) : listRelationshipsForWorkspace(workspace.id),
        role === "staff" ? Promise.resolve([]) : listActiveWorkspaceKeyResults(workspace.id),
    ])

    return Response.json({
        workOptions: workItems
            .filter((candidate) => !allowedWorkItemIds || allowedWorkItemIds.has(candidate.id))
            .map((candidate) => ({ id: candidate.id, title: candidate.title, status: candidate.status })),
        relationshipOptions: relationships
            .filter((relationship) => !allowedRelationshipIds || allowedRelationshipIds.has(relationship.id))
            .map((relationship) => ({ id: relationship.id, label: relationship.business_name ?? relationship.primary_person_name })),
        keyResultOptions: keyResults.map((result) => ({ ...result, code: `KR-${shortId(result.id)}` })),
    }, { headers: { "Cache-Control": "private, no-store" } })
}
