export const WORKSPACE_CAPABILITIES = [
    "relationships.view",
    "onboarding.manage",
    "fulfilment.manage",
    "appointment_setting.manage",
    "communications.manage",
    "library.manage",
    "onboarding_builder.manage",
    "leadgen.manage",
    "admin.manage",
    "settings.manage",
] as const

export type WorkspaceCapability = (typeof WORKSPACE_CAPABILITIES)[number]

export const DEFAULT_SERVICE_CAPABILITIES = [
    "onboarding.manage",
    "fulfilment.manage",
] as const satisfies readonly WorkspaceCapability[]

export function normalizeWorkspaceCapability(value: unknown): WorkspaceCapability | null {
    return typeof value === "string" && (WORKSPACE_CAPABILITIES as readonly string[]).includes(value)
        ? value as WorkspaceCapability
        : null
}
