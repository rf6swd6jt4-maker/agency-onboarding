import { redirect } from "next/navigation"
import type { User } from "@supabase/supabase-js"
import { redirectToLogin } from "@/lib/auth/server-redirects"
import { getVerifiedUser } from "@/lib/auth/verified-user"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { normalizeWorkspaceRole, workspaceRoleMeetsMinimum, type WorkspaceRole } from "@/lib/workspace-roles"

export { WORKSPACE_ROLES, normalizeWorkspaceRole, workspaceRoleLabel, type WorkspaceRole } from "@/lib/workspace-roles"

type Workspace = {
    id: string
    name: string
    slug: string
    status: "active" | "suspended"
    banner_path: string | null
    logo_path: string | null
    banner_height: number
    banner_position: number
    leadgen_banner_path: string | null
    leadgen_banner_height: number
    leadgen_banner_position: number
    custom_onboarding_domain: string | null
    custom_onboarding_domain_status: "none" | "pending_dns" | "verified"
    custom_onboarding_domain_records: Array<{ type: "A" | "CNAME" | "TXT"; name: string; value: string }>
    custom_onboarding_domain_error: string | null
}

export function isValidWorkspaceSlug(value: string) {
    return /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])?$/.test(value)
}

export async function getCurrentUser() {
    const supabase = await createSupabaseServerClient()
    return getVerifiedUser(supabase)
}

export async function requireWorkspace(
    slug: string,
    minimumRole: WorkspaceRole = "staff"
): Promise<{ user: User; workspace: Workspace; role: WorkspaceRole }> {
    const supabase = await createSupabaseServerClient()
    const user = await getVerifiedUser(supabase)
    if (!user) return await redirectToLogin()

    const workspaceResult = await supabaseAdmin
        .from("workspaces")
        .select("id, name, slug, status, banner_path, logo_path, banner_height, banner_position, leadgen_banner_path, leadgen_banner_height, leadgen_banner_position, custom_onboarding_domain, custom_onboarding_domain_status, custom_onboarding_domain_records, custom_onboarding_domain_error")
        .eq("slug", slug)
        .maybeSingle() as { data: Workspace | null; error: { message: string } | null }

    let workspace = workspaceResult.data
    if (workspaceResult.error?.message.includes("custom_onboarding_domain") || workspaceResult.error?.message.includes("leadgen_banner")) {
        const { data: legacyWorkspace } = await supabaseAdmin
            .from("workspaces")
            .select("id, name, slug, status, banner_path, logo_path, banner_height, banner_position")
            .eq("slug", slug)
            .maybeSingle()
        workspace = legacyWorkspace
            ? { ...legacyWorkspace, leadgen_banner_path: null, leadgen_banner_height: 192, leadgen_banner_position: 50, custom_onboarding_domain: null, custom_onboarding_domain_status: "none", custom_onboarding_domain_records: [], custom_onboarding_domain_error: null }
            : null
    }

    const { data: membership } = workspace
        ? await supabaseAdmin
              .from("workspace_memberships")
              .select("role")
              .eq("workspace_id", workspace.id)
              .eq("user_id", user.id)
              .maybeSingle()
        : { data: null }

    const role = normalizeWorkspaceRole(membership?.role)
    if (
        !membership ||
        !role ||
        !workspace ||
        workspace.status !== "active" ||
        !workspaceRoleMeetsMinimum(role, minimumRole)
    ) {
        redirect("/workspaces")
    }

    return { user, workspace, role }
}

export async function getWorkspaceForPublicOnboarding(slug: string) {
    const supabase = await createSupabaseServerClient()
    const { data } = await supabase
        .from("workspaces")
        .select("id, slug, name, status")
        .eq("slug", slug)
        .eq("status", "active")
        .maybeSingle()
    return data
}
