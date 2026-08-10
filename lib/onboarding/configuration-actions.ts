import { revalidatePath } from "next/cache"
import { recordAdminActivity } from "@/lib/admin/activity"
import { platformFailureFingerprint, reportPlatformFailure } from "@/lib/admin/maintenance"
import { supabaseAdmin } from "@/lib/supabase/admin"
import type { ConfigurationActionResult } from "@/lib/onboarding/configuration-types"

export function configurationSchemaUnavailable(id?: string | null) {
    return Boolean(id?.startsWith("legacy:"))
}

export function revalidateOnboardingConfiguration(slug: string) {
    revalidatePath(`/${slug}/settings`)
    revalidatePath(`/${slug}/onboarding-builder`)
    revalidatePath(`/${slug}/relationships`)
    revalidatePath(`/${slug}/onboarding`)
}

const CONFIGURATION_BUSINESS_ERROR_CODES = new Set(["22023", "P0001", "P0002", "40001", "42501"])

function configurationCategory(operation: string) {
    return operation.includes("service") ? "services" as const : "onboarding" as const
}

function configurationActor(args: Record<string, unknown>) {
    return {
        workspaceId: typeof args.p_workspace_id === "string" ? args.p_workspace_id : null,
        actorUserId: typeof args.p_actor_user_id === "string" ? args.p_actor_user_id : null,
    }
}

export async function configurationRpc<T>(name: string, args: Record<string, unknown>): Promise<ConfigurationActionResult<T>> {
    const { data, error } = await supabaseAdmin.rpc(name, args)
    if (error) {
        const { workspaceId, actorUserId } = configurationActor(args)
        const category = configurationCategory(name)
        if (CONFIGURATION_BUSINESS_ERROR_CODES.has(error.code)) {
            await recordAdminActivity({
                workspaceId,
                category,
                level: "warning",
                eventKey: `${name}.rejected`,
                summary: "Configuration change rejected",
                actorUserId,
                actorKind: "staff",
                outcome: "rejected",
                metricClassification: "audit",
                metadata: { operation: name, error_code: error.code },
            })
            return { ok: false, error: error.message.trim().slice(0, 400) }
        }
        const fingerprint = platformFailureFingerprint(["onboarding-configuration", name, error.code])
        await reportPlatformFailure({
            workspaceId,
            category,
            source: "onboarding_configuration_action",
            operation: name,
            fingerprint,
            severity: /^(08|XX)/.test(error.code) ? "critical" : "warning",
            summary: "An onboarding configuration action failed",
            diagnostics: { error_code: error.code, operation: name },
            actorUserId,
        })
        const schemaUnavailable = error.code === "42883" || error.code === "PGRST202" || error.message.toLowerCase().includes("schema cache")
        return { ok: false, error: schemaUnavailable
            ? "Onboarding configuration is temporarily unavailable while the latest database update is applied."
            : "The onboarding configuration could not be saved. The failure was recorded for an administrator." }
    }
    const value = Array.isArray(data) && data.length === 1 ? data[0] : data
    return { ok: true, data: value as T }
}

export function unexpectedConfigurationError(error: unknown) {
    console.warn("Unexpected onboarding configuration action failure", { error: error instanceof Error ? error.name : typeof error })
    return { ok: false as const, error: "The onboarding configuration could not be saved. The failure was recorded for an administrator." }
}
