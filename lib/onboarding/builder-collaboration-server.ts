import "server-only"

import * as Y from "yjs"
import { configurationRpc, unexpectedConfigurationError } from "@/lib/onboarding/configuration-actions"
import type { ConfigurationActionResult } from "@/lib/onboarding/configuration-types"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

export type CollaborativeUpdateResult = { sequence: number; version: number }
export type CollaborativeUpdate = { sequence: number; updateId: string; updateBase64: string }

function decodeUpdate(base64: string) {
    return new Uint8Array(Buffer.from(base64, "base64"))
}

async function maybeCompactBuilderDocument(workspaceId: string, userId: string) {
    const [{ data: document }, { data: updates }] = await Promise.all([
        supabaseAdmin.from("onboarding_builder_documents").select("snapshot_base64, snapshot_sequence").eq("workspace_id", workspaceId).maybeSingle(),
        supabaseAdmin.from("onboarding_builder_updates").select("sequence, update_base64").eq("workspace_id", workspaceId).order("sequence").limit(300),
    ])
    if (!updates || updates.length < 250) return
    const ydoc = new Y.Doc()
    if (document?.snapshot_base64) Y.applyUpdate(ydoc, decodeUpdate(document.snapshot_base64))
    for (const update of updates) Y.applyUpdate(ydoc, decodeUpdate(update.update_base64))
    const snapshot = Buffer.from(Y.encodeStateAsUpdate(ydoc)).toString("base64")
    await configurationRpc("compact_onboarding_builder_document", {
        p_workspace_id: workspaceId,
        p_actor_user_id: userId,
        p_snapshot_base64: snapshot,
        p_snapshot_sequence: Number(updates.at(-1)?.sequence ?? document?.snapshot_sequence ?? 0),
    })
}

export async function persistVisualBuilderUpdate(slug: string, updateId: string, updateBase64: string, definitionIds: string[]): Promise<ConfigurationActionResult<CollaborativeUpdateResult>> {
    try {
        const { workspace, user } = await requireWorkspace(slug, "admin")
        if (!/^[0-9a-f-]{36}:[0-9]+$/i.test(updateId) || !/^[A-Za-z0-9+/=]+$/.test(updateBase64) || updateBase64.length > 1_400_000 || definitionIds.some((id) => !/^[a-zA-Z0-9:_-]{1,160}$/.test(id))) {
            return { ok: false, error: "The collaborative update was invalid." }
        }
        const outcome = await configurationRpc<CollaborativeUpdateResult>("append_onboarding_builder_update", {
            p_workspace_id: workspace.id,
            p_actor_user_id: user.id,
            p_update_id: updateId,
            p_update_base64: updateBase64,
            p_definition_ids: [...new Set(definitionIds)].slice(0, 100),
        })
        if (outcome.ok) await maybeCompactBuilderDocument(workspace.id, user.id)
        return outcome
    } catch (error) {
        return unexpectedConfigurationError(error)
    }
}

export async function loadVisualBuilderUpdates(slug: string, afterSequence: number): Promise<ConfigurationActionResult<{ version: number; snapshotBase64: string | null; snapshotSequence: number; updates: CollaborativeUpdate[] }>> {
    try {
        const { workspace } = await requireWorkspace(slug, "admin")
        const { data: document, error: documentError } = await supabaseAdmin.from("onboarding_builder_documents").select("version, snapshot_base64, snapshot_sequence").eq("workspace_id", workspace.id).maybeSingle()
        if (documentError) return { ok: false, error: "Could not refresh collaborative changes." }
        const snapshotSequence = Number(document?.snapshot_sequence ?? 0)
        const includeSnapshot = Boolean(document?.snapshot_base64) && afterSequence < snapshotSequence
        const { data: updates, error: updatesError } = await supabaseAdmin.from("onboarding_builder_updates")
            .select("sequence, update_id, update_base64")
            .eq("workspace_id", workspace.id)
            .gt("sequence", includeSnapshot ? snapshotSequence : afterSequence)
            .order("sequence")
            .limit(2_000)
        if (updatesError) return { ok: false, error: "Could not refresh collaborative changes." }
        return {
            ok: true,
            data: {
                version: Number(document?.version ?? 0),
                snapshotBase64: includeSnapshot ? String(document?.snapshot_base64) : null,
                snapshotSequence,
                updates: (updates ?? []).map((update) => ({
                    sequence: Number(update.sequence),
                    updateId: String(update.update_id),
                    updateBase64: String(update.update_base64),
                })),
            },
        }
    } catch (error) {
        return unexpectedConfigurationError(error)
    }
}
