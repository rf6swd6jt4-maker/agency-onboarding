import type { OnboardingServiceDefinition, OnboardingServiceState } from "./configuration-types"

export type LegacyServiceDefinition = {
    title: string
    description: string
    sopSteps: Array<{ key: string; title: string; description?: string }>
}

export type StoredRelationshipService = {
    service_key: string
    service_id?: string | null
    service_revision_id?: string | null
    price_cents?: number | null
    currency?: string | null
    assignee_user_id?: string | null
}

export type OnboardingServiceRevisionDisplay = {
    id: string
    serviceId: string
    revisionNumber: number
    name: string
    description: string
    defaultPriceCents: number
    currency: string
    isTest: boolean
}

export type RelationshipDealServiceOption = {
    code: string
    serviceId: string | null
    revisionId: string | null
    name: string
    description: string
    defaultPriceCents: number
    currency: string
    defaultAssigneeId: string | null
    isTest: boolean
    state: OnboardingServiceState | "legacy"
    revisionNumber: number | null
    selected: StoredRelationshipService | null
}

export function relationshipServiceDisplayNameCore(
    service: Pick<StoredRelationshipService, "service_key" | "service_revision_id">,
    revisions: ReadonlyMap<string, OnboardingServiceRevisionDisplay>,
    legacyServices: Readonly<Record<string, LegacyServiceDefinition>>,
) {
    const revisionName = service.service_revision_id ? revisions.get(service.service_revision_id)?.name : null
    return revisionName ?? legacyServices[service.service_key]?.title ?? service.service_key
}

export function relationshipFulfilmentServiceDefinitionCore(
    serviceKey: string,
    immutableRevisionName: string | null | undefined,
    legacyServices: Readonly<Record<string, LegacyServiceDefinition>>,
) {
    const legacy = legacyServices[serviceKey]
    const name = immutableRevisionName?.trim() || legacy?.title || serviceKey
    return {
        code: serviceKey,
        name,
        steps: legacy?.sopSteps?.length
            ? legacy.sopSteps
            : [{ key: "complete", title: `Complete ${name}`, description: "Complete this service's delivery work." }],
    }
}

export function buildRelationshipDealServiceOptionsCore(input: {
    schemaReady: boolean
    services: OnboardingServiceDefinition[]
    selected: StoredRelationshipService[]
    revisions: ReadonlyMap<string, OnboardingServiceRevisionDisplay>
}, legacyServices: Readonly<Record<string, LegacyServiceDefinition>>) {
    const selectedByServiceId = new Map(input.selected.flatMap((service) => service.service_id ? [[service.service_id, service] as const] : []))
    const selectedByCode = new Map(input.selected.map((service) => [service.service_key, service]))
    const options = new Map<string, RelationshipDealServiceOption>()

    if (input.schemaReady) {
        for (const service of input.services.filter((candidate) => candidate.state === "active")) {
            const selected = selectedByServiceId.get(service.id) ?? selectedByCode.get(service.code) ?? null
            const selectedRevision = selected?.service_revision_id ? input.revisions.get(selected.service_revision_id) : null
            options.set(service.code, {
                code: service.code,
                serviceId: selected?.service_id ?? service.id,
                revisionId: selected?.service_revision_id ?? service.revisionId,
                name: selectedRevision?.name ?? service.name,
                description: selectedRevision?.description ?? service.description,
                defaultPriceCents: selectedRevision?.defaultPriceCents ?? service.defaultPriceCents,
                currency: (selectedRevision?.currency ?? service.currency).toUpperCase(),
                defaultAssigneeId: selected?.assignee_user_id ?? service.defaultAssigneeId,
                isTest: selectedRevision?.isTest ?? service.isTest,
                state: service.state,
                revisionNumber: selectedRevision?.revisionNumber ?? service.version,
                selected,
            })
        }
    } else {
        for (const [code, service] of Object.entries(legacyServices)) {
            const selected = selectedByCode.get(code) ?? null
            options.set(code, {
                code,
                serviceId: selected?.service_id ?? null,
                revisionId: selected?.service_revision_id ?? null,
                name: service.title,
                description: service.description,
                defaultPriceCents: 0,
                currency: (selected?.currency ?? "USD").toUpperCase(),
                defaultAssigneeId: selected?.assignee_user_id ?? null,
                isTest: false,
                state: "legacy",
                revisionNumber: null,
                selected,
            })
        }
    }

    for (const selected of input.selected) {
        if (options.has(selected.service_key)) continue
        const current = input.services.find((service) => service.id === selected.service_id || service.code === selected.service_key)
        const revision = selected.service_revision_id ? input.revisions.get(selected.service_revision_id) : null
        options.set(selected.service_key, {
            code: selected.service_key,
            serviceId: selected.service_id ?? current?.id ?? null,
            revisionId: selected.service_revision_id ?? current?.revisionId ?? null,
            name: revision?.name ?? current?.name ?? legacyServices[selected.service_key]?.title ?? selected.service_key,
            description: revision?.description ?? current?.description ?? legacyServices[selected.service_key]?.description ?? "Existing relationship service",
            defaultPriceCents: revision?.defaultPriceCents ?? current?.defaultPriceCents ?? 0,
            currency: (revision?.currency ?? current?.currency ?? selected.currency ?? "USD").toUpperCase(),
            defaultAssigneeId: selected.assignee_user_id ?? current?.defaultAssigneeId ?? null,
            isTest: revision?.isTest ?? current?.isTest ?? false,
            state: current?.state ?? "legacy",
            revisionNumber: revision?.revisionNumber ?? current?.version ?? null,
            selected,
        })
    }

    return [...options.values()].sort((left, right) => left.name.localeCompare(right.name))
}
