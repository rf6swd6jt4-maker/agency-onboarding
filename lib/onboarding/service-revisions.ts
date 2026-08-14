import "server-only"

import { supabaseAdmin } from "@/lib/supabase/admin"
import type { OnboardingServiceRevisionDisplay } from "@/lib/onboarding/service-display"

export async function loadOnboardingServiceRevisionDisplays(workspaceId: string, revisionIds: Array<string | null | undefined>) {
    const ids = [...new Set(revisionIds.filter((id): id is string => Boolean(id)))]
    if (!ids.length) return new Map<string, OnboardingServiceRevisionDisplay>()
    const { data, error } = await supabaseAdmin
        .from("onboarding_service_revisions")
        .select("id, service_id, revision_number, name, description, default_price_cents, default_upfront_price_cents, default_recurring_price_cents, currency, is_test, definition")
        .eq("workspace_id", workspaceId)
        .in("id", ids)
    if (error) return new Map<string, OnboardingServiceRevisionDisplay>()
    return new Map<string, OnboardingServiceRevisionDisplay>((data ?? []).map((revision): [string, OnboardingServiceRevisionDisplay] => {
        const definition = revision.definition && typeof revision.definition === "object" && !Array.isArray(revision.definition)
            ? revision.definition as Record<string, unknown>
            : {}
        const hasExplicitUpfrontDefault = typeof definition.defaultUpfrontPriceCents === "number"
            || typeof definition.default_upfront_price_cents === "number"
        const hasExplicitRecurringDefault = typeof definition.defaultRecurringPriceCents === "number"
            || typeof definition.default_recurring_price_cents === "number"
        const storedUpfrontDefault = Number(revision.default_upfront_price_cents) || 0
        const defaultRecurringPriceCents = hasExplicitRecurringDefault
            ? Number(definition.defaultRecurringPriceCents ?? definition.default_recurring_price_cents) || 0
            : Number(revision.default_recurring_price_cents) || 0
        const storedServiceType = definition.serviceType ?? definition.service_type
        const serviceType = storedServiceType === "retainer" || defaultRecurringPriceCents > 0 ? "retainer" : "one_time"
        const storedInterval = definition.defaultBillingInterval ?? definition.default_billing_interval
        const defaultBillingInterval = storedInterval === "week" || storedInterval === "year" ? storedInterval : "month"
        return [revision.id, {
        id: revision.id,
        serviceId: revision.service_id,
        revisionNumber: Number(revision.revision_number) || 1,
        name: revision.name,
        description: revision.description ?? "",
        serviceType,
        recurringName: serviceType === "retainer" ? String(definition.recurringName ?? definition.recurring_name ?? definition.checkoutDisplayName ?? revision.name) : "",
        recurringDescription: serviceType === "retainer" ? String(definition.recurringDescription ?? definition.recurring_description ?? definition.checkoutDescription ?? revision.description ?? "") : "",
        defaultBillingInterval,
        defaultBillingIntervalCount: Math.max(1, Number(definition.defaultBillingIntervalCount ?? definition.default_billing_interval_count) || 1),
        checkoutDisplayName: typeof definition.checkoutDisplayName === "string" ? definition.checkoutDisplayName : "",
        checkoutDescription: typeof definition.checkoutDescription === "string" ? definition.checkoutDescription : "",
        thumbnailPath: typeof definition.thumbnailPath === "string" ? definition.thumbnailPath : null,
        defaultUpfrontPriceCents: hasExplicitUpfrontDefault
            ? Number(definition.defaultUpfrontPriceCents ?? definition.default_upfront_price_cents) || 0
            : storedUpfrontDefault > 0 ? storedUpfrontDefault : Number(revision.default_price_cents) || 0,
        defaultRecurringPriceCents,
        currency: String(revision.currency ?? "USD").toUpperCase(),
        isTest: Boolean(revision.is_test),
    }]
    }))
}
