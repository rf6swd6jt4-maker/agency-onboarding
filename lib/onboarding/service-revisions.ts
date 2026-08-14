import "server-only"

import { supabaseAdmin } from "@/lib/supabase/admin"
import type { OnboardingServiceRevisionDisplay } from "@/lib/onboarding/service-display"

export async function loadOnboardingServiceRevisionDisplays(workspaceId: string, revisionIds: Array<string | null | undefined>) {
    const ids = [...new Set(revisionIds.filter((id): id is string => Boolean(id)))]
    if (!ids.length) return new Map<string, OnboardingServiceRevisionDisplay>()
    const { data, error } = await supabaseAdmin
        .from("onboarding_service_revisions")
        .select("id, service_id, revision_number, name, description, default_upfront_price_cents, default_recurring_price_cents, currency, is_test, definition")
        .eq("workspace_id", workspaceId)
        .in("id", ids)
    if (error) return new Map<string, OnboardingServiceRevisionDisplay>()
    return new Map((data ?? []).map((revision) => {
        const definition = revision.definition && typeof revision.definition === "object" && !Array.isArray(revision.definition)
            ? revision.definition as Record<string, unknown>
            : {}
        return [revision.id, {
        id: revision.id,
        serviceId: revision.service_id,
        revisionNumber: Number(revision.revision_number) || 1,
        name: revision.name,
        description: revision.description ?? "",
        checkoutDisplayName: typeof definition.checkoutDisplayName === "string" ? definition.checkoutDisplayName : "",
        checkoutDescription: typeof definition.checkoutDescription === "string" ? definition.checkoutDescription : "",
        thumbnailPath: typeof definition.thumbnailPath === "string" ? definition.thumbnailPath : null,
        defaultUpfrontPriceCents: Number(revision.default_upfront_price_cents) || 0,
        defaultRecurringPriceCents: Number(revision.default_recurring_price_cents) || 0,
        currency: String(revision.currency ?? "USD").toUpperCase(),
        isTest: Boolean(revision.is_test),
    }]
    }))
}
