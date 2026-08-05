import { notFound, redirect } from "next/navigation"
import { getWorkspaceOkr } from "@/lib/admin/okrs"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ workspaceSlug: string; okrId: string }> }

export default async function OkrDetailPage({ params }: PageProps) {
    const { workspaceSlug, okrId } = await params
    const { workspace } = await requireWorkspace(workspaceSlug, "admin")
    const okr = await getWorkspaceOkr(workspace.id, okrId)
    if (!okr) notFound()
    redirect(`/${workspace.slug}/admin?view=okrs#okr-${okr.id}`)
}
