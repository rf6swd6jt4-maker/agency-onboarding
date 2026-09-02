import { redirect } from "next/navigation"
import { defaultWorkspaceHref, requireWorkspaceAccess } from "@/lib/workspace-access"

type PageProps = { params: Promise<{ workspaceSlug: string }> }

export default async function WorkspaceDashboard({ params }: PageProps) {
    const { workspaceSlug } = await params
    const { access } = await requireWorkspaceAccess(workspaceSlug)
    redirect(defaultWorkspaceHref(access))
}
