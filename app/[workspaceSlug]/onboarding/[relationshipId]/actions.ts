"use server"

import { randomBytes } from "crypto"
import { revalidatePath } from "next/cache"
import { createRelationshipOnboardingSession } from "@/lib/onboarding/canonical"
import { getOnboardingUrl } from "@/lib/onboarding/client-creation"
import { recordAdminActivity } from "@/lib/admin/activity"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireRelationshipAccess, requireWorkspacePanel } from "@/lib/workspace-access"

type MutationRpcError = { code?: string; message?: string } | null | undefined

function isMissingOnboardingMutationRpc(error: MutationRpcError, functionName: string) {
    const message = error?.message?.toLowerCase() ?? ""
    return error?.code === "42883" || error?.code === "PGRST202" || (
        message.includes(functionName.toLowerCase()) && (
            message.includes("schema cache") || message.includes("does not exist") || message.includes("could not find")
        )
    )
}

async function requireOnboardingManager(workspaceSlug: string, relationshipId: string) {
    const access = await requireWorkspacePanel(workspaceSlug, "onboarding")
    await requireRelationshipAccess(access.access, relationshipId)
    if (access.role !== "owner" && access.role !== "admin") throw new Error("You do not have permission to manage onboarding")
    const { data: relationship } = await supabaseAdmin
        .from("relationships")
        .select("id")
        .eq("id", relationshipId)
        .eq("workspace_id", access.workspace.id)
        .maybeSingle()
    if (!relationship) throw new Error("Relationship not found")
    return access
}

export async function archiveOnboarding(workspaceSlug: string, relationshipId: string) {
    const { workspace, user } = await requireOnboardingManager(workspaceSlug, relationshipId)
    const { data: session } = await supabaseAdmin
        .from("relationship_onboarding_sessions")
        .select("id, source_sale_id")
        .eq("workspace_id", workspace.id)
        .eq("relationship_id", relationshipId)
        .in("status", ["active", "completed"])
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    if (!session) return

    const { error: rpcError } = await supabaseAdmin.rpc("archive_relationship_onboarding_session", {
        p_workspace_id: workspace.id,
        p_relationship_id: relationshipId,
        p_session_id: session.id,
        p_actor_user_id: user.id,
        p_correlation_id: session.source_sale_id ?? session.id,
        p_idempotency_key: `onboarding.session.archived:${session.id}`,
    })
    if (!rpcError) {
        revalidatePath(`/${workspace.slug}/onboarding`)
        revalidatePath(`/${workspace.slug}/onboarding/${relationshipId}`)
        return
    }
    if (!isMissingOnboardingMutationRpc(rpcError, "archive_relationship_onboarding_session")) {
        throw new Error(rpcError.message || "Could not archive onboarding")
    }

    const now = new Date().toISOString()
    const { error } = await supabaseAdmin
        .from("relationship_onboarding_sessions")
        .update({ status: "archived", archived_at: now })
        .eq("id", session.id)
        .eq("workspace_id", workspace.id)
    if (error) throw new Error("Could not archive onboarding")

    const { error: workItemsError } = await supabaseAdmin
        .from("work_items")
        .update({ status: "canceled", updated_at: now })
        .eq("workspace_id", workspace.id)
        .eq("native_kind", "onboarding_step")
        .like("native_key", `${session.id}:%`)
        .neq("status", "done")
    if (workItemsError) throw new Error("Onboarding was archived, but unfinished work could not be canceled")

    revalidatePath(`/${workspace.slug}/onboarding`)
    revalidatePath(`/${workspace.slug}/onboarding/${relationshipId}`)
}

export async function restartOnboarding(workspaceSlug: string, relationshipId: string) {
    const { workspace, user } = await requireOnboardingManager(workspaceSlug, relationshipId)
    const [{ data: modules }, { data: services }, { data: currentSession }] = await Promise.all([
        supabaseAdmin.from("relationship_onboarding_modules").select("module_key").eq("workspace_id", workspace.id).eq("relationship_id", relationshipId),
        supabaseAdmin.from("relationship_services").select("service_key").eq("workspace_id", workspace.id).eq("relationship_id", relationshipId),
        supabaseAdmin.from("relationship_onboarding_sessions").select("id, status, source_sale_id").eq("workspace_id", workspace.id).eq("relationship_id", relationshipId).in("status", ["active", "completed"]).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    ])

    let archivedWithRpc = false
    let archiveEventId: string | null = null
    if (currentSession) {
        const { data, error: archiveRpcError } = await supabaseAdmin.rpc("archive_relationship_onboarding_session", {
            p_workspace_id: workspace.id,
            p_relationship_id: relationshipId,
            p_session_id: currentSession.id,
            p_actor_user_id: user.id,
            p_correlation_id: currentSession.source_sale_id ?? currentSession.id,
            p_idempotency_key: `onboarding.session.archived:${currentSession.id}`,
        })
        if (!archiveRpcError) {
            archivedWithRpc = true
            archiveEventId = data && typeof data === "object" && "event_id" in data && typeof (data as { event_id?: unknown }).event_id === "string"
                ? (data as { event_id: string }).event_id
                : null
        } else if (!isMissingOnboardingMutationRpc(archiveRpcError, "archive_relationship_onboarding_session")) {
            throw new Error(archiveRpcError.message || "Could not archive the current onboarding session")
        }
    }

    if (currentSession?.status === "completed" && !archivedWithRpc) {
        const { error } = await supabaseAdmin
            .from("relationship_onboarding_sessions")
            .update({ status: "archived", archived_at: new Date().toISOString() })
            .eq("id", currentSession.id)
            .eq("workspace_id", workspace.id)
        if (error) throw new Error("Could not archive the completed onboarding session")
    }

    const nextSession = await createRelationshipOnboardingSession({
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
        relationshipId,
        moduleKeys: (modules ?? []).map((module) => module.module_key),
        serviceKeys: (services ?? []).map((service) => service.service_key),
        createdBy: user.id,
    })
    if (currentSession && nextSession.created) {
        await recordAdminActivity({
            workspaceId: workspace.id,
            category: "onboarding",
            eventKey: "onboarding.session.restarted",
            summary: "Onboarding session restarted",
            entityType: "onboarding_session",
            entityId: nextSession.id,
            actorUserId: user.id,
            correlationId: nextSession.id,
            causationEventId: archiveEventId,
            idempotencyKey: `onboarding.session.restarted:${currentSession.id}:${nextSession.id}`,
            sourceHref: `/${workspace.slug}/onboarding/${relationshipId}`,
            metadata: {
                relationship_id: relationshipId,
                previous_session_id: currentSession.id,
                session_id: nextSession.id,
            },
        })
    }
}

export async function revokeOnboardingToken(workspaceSlug: string, relationshipId: string) {
    const { workspace, user } = await requireOnboardingManager(workspaceSlug, relationshipId)
    const { data: session } = await supabaseAdmin.from("relationship_onboarding_sessions")
        .select("id, token_revoked_at, token_version, source_sale_id")
        .eq("workspace_id", workspace.id).eq("relationship_id", relationshipId)
        .in("status", ["active", "completed"]).order("updated_at", { ascending: false }).limit(1).maybeSingle()
    if (!session || session.token_revoked_at) return { ok: true as const, revoked: true as const }
    const tokenVersion = Number(session.token_version) || 1
    const correlationId = session.source_sale_id ?? session.id
    const idempotencyKey = `onboarding.token.revoked:${session.id}:${tokenVersion}`
    const { error: rpcError } = await supabaseAdmin.rpc("revoke_relationship_onboarding_session_token", {
        p_workspace_id: workspace.id,
        p_relationship_id: relationshipId,
        p_session_id: session.id,
        p_actor_user_id: user.id,
        p_expected_token_version: tokenVersion,
        p_correlation_id: correlationId,
        p_idempotency_key: idempotencyKey,
    })
    if (!rpcError) {
        revalidatePath(`/${workspace.slug}/onboarding/${relationshipId}`)
        return { ok: true as const, revoked: true as const }
    }
    if (!isMissingOnboardingMutationRpc(rpcError, "revoke_relationship_onboarding_session_token")) {
        throw new Error(rpcError.message || "Could not revoke the onboarding link")
    }
    const { error } = await supabaseAdmin.from("relationship_onboarding_sessions")
        .update({ token_revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("workspace_id", workspace.id).eq("id", session.id).is("token_revoked_at", null)
    if (error) throw new Error("Could not revoke the onboarding link")
    await recordAdminActivity({
        workspaceId: workspace.id,
        category: "onboarding",
        eventKey: "onboarding.token.revoked",
        summary: "Onboarding link revoked",
        entityType: "onboarding_session",
        entityId: session.id,
        actorUserId: user.id,
        correlationId,
        idempotencyKey,
        sourceHref: `/${workspace.slug}/onboarding/${relationshipId}`,
        metadata: { relationship_id: relationshipId, token_version: session.token_version ?? 1 },
    })
    revalidatePath(`/${workspace.slug}/onboarding/${relationshipId}`)
    return { ok: true as const, revoked: true as const }
}

export async function rotateOnboardingToken(workspaceSlug: string, relationshipId: string) {
    const { workspace, user } = await requireOnboardingManager(workspaceSlug, relationshipId)
    const { data: session } = await supabaseAdmin.from("relationship_onboarding_sessions")
        .select("id, token_version, source_sale_id")
        .eq("workspace_id", workspace.id).eq("relationship_id", relationshipId)
        .in("status", ["active", "completed"]).order("updated_at", { ascending: false }).limit(1).maybeSingle()
    if (!session) throw new Error("Onboarding session not found")
    const token = randomBytes(32).toString("hex")
    const tokenVersion = (Number(session.token_version) || 1) + 1
    const correlationId = session.source_sale_id ?? session.id
    const idempotencyKey = `onboarding.token.rotated:${session.id}:${tokenVersion}`
    const { error: rpcError } = await supabaseAdmin.rpc("rotate_relationship_onboarding_session_token", {
        p_workspace_id: workspace.id,
        p_relationship_id: relationshipId,
        p_session_id: session.id,
        p_actor_user_id: user.id,
        p_expected_token_version: tokenVersion - 1,
        p_new_token: token,
        p_correlation_id: correlationId,
        p_idempotency_key: idempotencyKey,
    })
    if (!rpcError) {
        revalidatePath(`/${workspace.slug}/onboarding/${relationshipId}`)
        return {
            ok: true as const,
            path: getOnboardingUrl(
                workspace.slug,
                token,
                workspace.custom_onboarding_domain,
                workspace.custom_onboarding_domain_status === "verified"
            ),
        }
    }
    if (!isMissingOnboardingMutationRpc(rpcError, "rotate_relationship_onboarding_session_token")) {
        throw new Error(rpcError.message || "Could not rotate the onboarding link. Reload and try again")
    }
    const { data: updated, error } = await supabaseAdmin.from("relationship_onboarding_sessions")
        .update({ session_token: token, token_version: tokenVersion, token_revoked_at: null, updated_at: new Date().toISOString() })
        .eq("workspace_id", workspace.id).eq("id", session.id).eq("token_version", session.token_version ?? 1)
        .select("id").maybeSingle()
    if (error || !updated) throw new Error("Could not rotate the onboarding link. Reload and try again")
    await recordAdminActivity({
        workspaceId: workspace.id,
        category: "onboarding",
        eventKey: "onboarding.token.rotated",
        summary: "Onboarding link rotated",
        entityType: "onboarding_session",
        entityId: session.id,
        actorUserId: user.id,
        correlationId,
        idempotencyKey,
        sourceHref: `/${workspace.slug}/onboarding/${relationshipId}`,
        metadata: { relationship_id: relationshipId, token_version: tokenVersion },
    })
    revalidatePath(`/${workspace.slug}/onboarding/${relationshipId}`)
    return {
        ok: true as const,
        path: getOnboardingUrl(
            workspace.slug,
            token,
            workspace.custom_onboarding_domain,
            workspace.custom_onboarding_domain_status === "verified"
        ),
    }
}
