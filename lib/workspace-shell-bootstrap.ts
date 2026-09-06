import "server-only"

import { performance } from "node:perf_hooks"
import { redirect } from "next/navigation"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { requireAal2User } from "@/lib/auth/aal"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { combineWorkspaceCapabilities } from "@/lib/workspace-capabilities"
import type { WorkspaceShellBootstrapTiming } from "@/lib/workspace-launch"
import { normalizeWorkspaceRole } from "@/lib/workspace-roles"
import { requireWorkspaceAccess, type WorkspaceAccess } from "@/lib/workspace-access"

type RawWorkspaceShellBootstrap = {
    workspace_id?: unknown
    workspace_name?: unknown
    workspace_slug?: unknown
    logo_path?: unknown
    role?: unknown
    username?: unknown
    avatar_path?: unknown
    capabilities?: unknown
    allowed_service_ids?: unknown
    service_access_schema_ready?: unknown
}

function roundedDuration(startedAt: number) {
    return Math.max(0, Math.round((performance.now() - startedAt) * 10) / 10)
}

function stringArray(value: unknown) {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item)) : []
}

function validBootstrap(value: unknown, expectedSlug: string, userId: string) {
    const raw = value && typeof value === "object" && !Array.isArray(value) ? value as RawWorkspaceShellBootstrap : null
    if (!raw) return null
    const role = normalizeWorkspaceRole(raw.role)
    if (!role || typeof raw.workspace_id !== "string" || typeof raw.workspace_name !== "string" || raw.workspace_slug !== expectedSlug) return null
    const capabilities = combineWorkspaceCapabilities([stringArray(raw.capabilities)])
    const access: WorkspaceAccess = {
        workspaceId: raw.workspace_id,
        workspaceSlug: expectedSlug,
        userId,
        role,
        capabilities,
        allowedServiceIds: stringArray(raw.allowed_service_ids),
        serviceAccessSchemaReady: raw.service_access_schema_ready === true,
    }
    return {
        workspace: {
            id: raw.workspace_id,
            name: raw.workspace_name,
            slug: expectedSlug,
            logo_path: typeof raw.logo_path === "string" ? raw.logo_path : null,
        },
        role,
        access,
        profile: {
            username: typeof raw.username === "string" && raw.username ? raw.username : "account",
            avatarPath: typeof raw.avatar_path === "string" ? raw.avatar_path : null,
        },
    }
}

export async function requireWorkspaceShellBootstrap(slug: string) {
    const startedAt = performance.now()
    const supabase = await createSupabaseServerClient()
    const authStartedAt = performance.now()
    const user = await requireAal2User(supabase)
    const authMs = roundedDuration(authStartedAt)
    const bootstrapStartedAt = performance.now()
    const { data, error } = await supabaseAdmin.rpc("workspace_shell_bootstrap", {
        p_workspace_slug: slug,
        p_user_id: user.id,
    })
    const bootstrapMs = roundedDuration(bootstrapStartedAt)
    const parsed = !error ? validBootstrap(data, slug, user.id) : null

    if (parsed) {
        return {
            user,
            ...parsed,
            timing: { authMs, bootstrapMs, totalMs: roundedDuration(startedAt), fallback: false } satisfies WorkspaceShellBootstrapTiming,
        }
    }

    // Keep the application available during a rolling database migration. This
    // path is intentionally observable so it cannot silently become permanent.
    console.warn("Workspace launch bootstrap fell back to legacy queries", { slug, code: error?.code })
    const legacy = await requireWorkspaceAccess(slug)
    if (legacy.user.id !== user.id) redirect("/workspaces")
    const { data: profile } = await supabaseAdmin
        .from("user_profiles")
        .select("username, avatar_path")
        .eq("user_id", user.id)
        .maybeSingle()
    return {
        ...legacy,
        profile: {
            username: profile?.username ?? "account",
            avatarPath: profile?.avatar_path ?? null,
        },
        timing: { authMs, bootstrapMs, totalMs: roundedDuration(startedAt), fallback: true } satisfies WorkspaceShellBootstrapTiming,
    }
}
