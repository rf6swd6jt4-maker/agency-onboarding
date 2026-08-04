import type { MaintenanceCategory } from "@/lib/admin/maintenance"

export type MaintenanceErrorDefinition = {
    code: `BGE-${number}`
    name: string
    source?: string
    operation?: string
    category?: MaintenanceCategory
}

export const MAINTENANCE_ERROR_CATALOGUE: readonly MaintenanceErrorDefinition[] = [
    { code: "BGE-1001", name: "Lead poll status update failed", source: "leadgen", operation: "update_poll_status" },
    { code: "BGE-1002", name: "Lead poll processing failed", source: "leadgen", operation: "poll_processing" },
    { code: "BGE-2001", name: "Onboarding step reconciliation failed", source: "canonical_onboarding", operation: "reconcile_step_window" },
    { code: "BGE-2002", name: "Onboarding work item creation failed", source: "canonical_onboarding", operation: "create_step_work_item" },
    { code: "BGE-2003", name: "Onboarding work item resolution failed", source: "canonical_onboarding", operation: "resolve_step_work_item" },
    { code: "BGE-2004", name: "Onboarding relationship link failed", source: "canonical_onboarding", operation: "link_step_relationship" },
    { code: "BGE-2005", name: "Onboarding dependency link failed", source: "canonical_onboarding", operation: "link_step_dependency" },
    { code: "BGE-2006", name: "Onboarding session completion failed", source: "canonical_onboarding", operation: "complete_session" },
    { code: "BGE-2007", name: "Onboarding workflow completion failed", source: "canonical_onboarding", operation: "complete_workflow" },
    { code: "BGE-2008", name: "Onboarding step completion failed", source: "canonical_onboarding", operation: "complete_step" },
    { code: "BGE-2009", name: "Next onboarding step failed to start", source: "canonical_onboarding", operation: "start_next_step" },
    { code: "BGE-2010", name: "Onboarding session creation failed", source: "canonical_onboarding", operation: "create_session" },
    { code: "BGE-3001", name: "Stripe event recording failed", source: "stripe_webhook", operation: "record_event" },
    { code: "BGE-3002", name: "Stripe paid invoice payload invalid", source: "stripe_webhook", operation: "paid_invoice_payload" },
    { code: "BGE-3003", name: "Paid invoice automation failed", source: "stripe_webhook", operation: "paid_invoice_automation" },
    { code: "BGE-3004", name: "Invoice status update failed", source: "stripe_webhook", operation: "update_invoice_status" },
    { code: "BGE-4101", name: "WhatsApp consent template not configured", source: "client_sales", operation: "send_consent_template" },
    { code: "BGE-4102", name: "WhatsApp consent template unavailable", source: "client_sales", operation: "send_consent_template" },
    { code: "BGE-4103", name: "WhatsApp authentication failed", source: "client_sales", operation: "send_consent_template" },
    { code: "BGE-4104", name: "WhatsApp rate limit reached", source: "client_sales", operation: "send_consent_template" },
    { code: "BGE-4105", name: "WhatsApp consent template send failed", source: "client_sales", operation: "send_consent_template" },
    { code: "BGE-4106", name: "WhatsApp consent send could not be claimed", source: "client_sales", operation: "claim_consent_send" },
    { code: "BGE-4107", name: "WhatsApp consent message log failed", source: "client_sales", operation: "create_consent_message_log" },
    { code: "BGE-4201", name: "WhatsApp message send failed", source: "clickup_whatsapp_bridge", operation: "send_whatsapp_message" },
    { code: "BGE-4202", name: "WhatsApp edited message send failed", source: "clickup_whatsapp_bridge", operation: "send_whatsapp_edit" },
    { code: "BGE-4203", name: "WhatsApp channel address repair failed", source: "meta_whatsapp", operation: "repair_channel_address" },
    { code: "BGE-4204", name: "WhatsApp message delivery failed", source: "meta_whatsapp", operation: "delivery_status" },
    { code: "BGE-5001", name: "ClickUp attachment sync failed", source: "clickup", operation: "sync_attachment" },
    { code: "BGE-5002", name: "ClickUp onboarding sync failed", source: "clickup", operation: "sync_onboarding_step" },
    { code: "BGE-5003", name: "ClickUp onboarding reset failed", source: "clickup", operation: "reset_onboarding_tasks" },
    { code: "BGE-5004", name: "ClickUp client channel creation failed", source: "clickup", operation: "create_client_channel" },
    { code: "BGE-5005", name: "ClickUp client resource cleanup failed", source: "clickup", operation: "delete_client_resources" },
    { code: "BGE-5006", name: "ClickUp connection check failed", source: "clickup", operation: "check_connection" },
    { code: "BGE-6001", name: "Gantt schedule update failed", source: "gantt", operation: "apply_schedule" },
    { code: "BGE-6002", name: "Gantt work item creation failed", source: "gantt", operation: "create_work_item" },
    { code: "BGE-6003", name: "Gantt work item move failed", source: "gantt", operation: "move_work_item" },
    { code: "BGE-6004", name: "Gantt dependency creation failed", source: "gantt", operation: "create_dependency" },
    { code: "BGE-6005", name: "Gantt dependency removal failed", source: "gantt", operation: "remove_dependency" },
    { code: "BGE-6101", name: "Officer settings update failed", source: "settings_officers", operation: "save" },
    { code: "BGE-6102", name: "OKR creation failed", source: "admin_okr", operation: "create" },
    { code: "BGE-6201", name: "Database schema mismatch", source: "next_error_boundary" },
    { code: "BGE-6202", name: "Application page asset failed to load", source: "next_error_boundary" },
    { code: "BGE-6203", name: "Application page failed to load", source: "next_error_boundary" },
    { code: "BGE-7001", name: "Client sale automation failed", source: "client_sales" },
    { code: "BGE-9001", name: "Lead generation failure", category: "leadgen" },
    { code: "BGE-9002", name: "Onboarding automation failure", category: "onboarding" },
    { code: "BGE-9003", name: "Billing automation failure", category: "billing" },
    { code: "BGE-9004", name: "Communications automation failure", category: "communications" },
    { code: "BGE-9005", name: "Integration automation failure", category: "integrations" },
    { code: "BGE-9006", name: "Platform operation failure", category: "system_health" },
    { code: "BGE-9998", name: "Previously reported platform failure" },
] as const

const exactCatalogue = new Map(
    MAINTENANCE_ERROR_CATALOGUE
        .filter((entry) => entry.source && entry.operation && entry.code !== "BGE-4101" && entry.code !== "BGE-4102" && entry.code !== "BGE-4103" && entry.code !== "BGE-4104")
        .map((entry) => [`${entry.source}.${entry.operation}`, entry])
)

function catalogueEntry(code: MaintenanceErrorDefinition["code"]) {
    return MAINTENANCE_ERROR_CATALOGUE.find((entry) => entry.code === code)!
}

function diagnosticText(diagnostics: Record<string, unknown> | undefined) {
    return Object.values(diagnostics ?? {}).filter((value) => typeof value === "string").join(" ").toLowerCase()
}

export function resolveMaintenanceError(input: {
    category: MaintenanceCategory
    source: string
    operation: string
    diagnostics?: Record<string, unknown>
}): MaintenanceErrorDefinition {
    const diagnostics = diagnosticText(input.diagnostics)
    if (input.source === "client_sales" && input.operation === "send_consent_template") {
        if (diagnostics.includes("missing meta_whatsapp") || diagnostics.includes("not configured")) return catalogueEntry("BGE-4101")
        if (diagnostics.includes("template") && (diagnostics.includes("not found") || diagnostics.includes("does not exist") || diagnostics.includes("unavailable"))) return catalogueEntry("BGE-4102")
        if (diagnostics.includes("token") || diagnostics.includes("oauth") || diagnostics.includes("unauthorized") || diagnostics.includes("authentication")) return catalogueEntry("BGE-4103")
        if (diagnostics.includes("rate limit") || diagnostics.includes("too many requests")) return catalogueEntry("BGE-4104")
        return catalogueEntry("BGE-4105")
    }
    if (input.source === "next_error_boundary") {
        if (/relation .* does not exist|column .* does not exist|schema cache|migration/.test(diagnostics)) return catalogueEntry("BGE-6201")
        if (/chunk|stylesheet|script|asset/.test(diagnostics)) return catalogueEntry("BGE-6202")
        return catalogueEntry("BGE-6203")
    }
    const exact = exactCatalogue.get(`${input.source}.${input.operation}`)
    if (exact) return exact
    const sourceFallback = MAINTENANCE_ERROR_CATALOGUE.find((entry) => entry.source === input.source && !entry.operation)
    if (sourceFallback) return sourceFallback
    return MAINTENANCE_ERROR_CATALOGUE.find((entry) => entry.category === input.category) ?? catalogueEntry("BGE-9006")
}

export function maintenanceBugTitle(error: MaintenanceErrorDefinition) {
    return `Bug: ${error.code} - ${error.name}`
}
