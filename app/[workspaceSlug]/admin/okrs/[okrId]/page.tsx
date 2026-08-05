import { notFound } from "next/navigation"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { getWorkspaceOkr } from "@/lib/admin/okrs"
import { okrDisplayTitle } from "@/lib/admin/okr-title"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { shortId } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"
import { OkrDetailClient } from "./OkrDetailClient"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ workspaceSlug: string; okrId: string }> }

export default async function OkrDetailPage({ params }: PageProps) {
    const { workspaceSlug, okrId } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    const okr = await getWorkspaceOkr(workspace.id, okrId)
    if (!okr) notFound()

    const [{ data: memberships }, { data: privateItems }] = await Promise.all([
        supabaseAdmin.from("workspace_memberships").select("user_id, role").eq("workspace_id", workspace.id).in("role", ["owner", "admin"]),
        okr.status === "active"
            ? supabaseAdmin.from("work_items").select("id, title, status").eq("workspace_id", workspace.id).eq("area", "admin").eq("visibility", "admins_only").order("updated_at", { ascending: false }).limit(100)
            : Promise.resolve({ data: [] }),
    ])
    const ids = (memberships ?? []).map((membership) => membership.user_id)
    const { data: profiles } = ids.length ? await supabaseAdmin.from("user_profiles").select("user_id, username").in("user_id", ids) : { data: [] }
    const names = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.username]))
    const people = (memberships ?? []).map((membership) => ({ user_id: membership.user_id, role: membership.role, name: names.get(membership.user_id) ?? membership.role }))

    return <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
        <div className="mx-auto max-w-[92rem]">
            <header className="border-b border-neutral-800 pb-5">
                <p className="font-mono text-sm text-neutral-500">OKR {shortId(okr.id)}</p>
                <h1 className="mt-2 max-w-5xl text-3xl font-semibold tracking-tight">{okrDisplayTitle({ objectiveType: okr.objective_type, objective: okr.objective, deadline: okr.period_end })}</h1>
            </header>
            <OkrDetailClient workspaceSlug={workspace.slug} okr={okr} people={people} privateItems={privateItems ?? []} recorderNames={Object.fromEntries(names)} />
        </div>
    </main>
}
