export type CompositionModuleCandidate = {
    id: string
    revisionId: string | null
    status: string
}

export type CompositionServiceCandidate = {
    revisionId: string | null
    code: string
    state: string
    displayPriority: number
    modules: Array<{ moduleId: string; sortOrder: number }>
}

export type OrderedModuleSource = {
    moduleId: string
    sourceKind: "mandatory" | "service"
    sourceServiceRevisionId: string | null
}

export function orderOnboardingServices<T extends CompositionServiceCandidate>(services: T[]) {
    return [...services]
        .filter((service) => service.state === "active" && service.revisionId)
        .sort((left, right) => right.displayPriority - left.displayPriority || left.code.localeCompare(right.code))
}

export function resolveOrderedModuleSources(input: {
    services: CompositionServiceCandidate[]
    modules: CompositionModuleCandidate[]
    mandatoryModuleIds: string[]
}): OrderedModuleSource[] {
    const moduleById = new Map(input.modules.map((moduleDefinition) => [moduleDefinition.id, moduleDefinition]))
    const selected = new Map<string, OrderedModuleSource>()

    for (const moduleId of input.mandatoryModuleIds) {
        const moduleDefinition = moduleById.get(moduleId)
        if (moduleDefinition?.status === "published" && moduleDefinition.revisionId) {
            selected.set(moduleDefinition.id, {
                moduleId: moduleDefinition.id,
                sourceKind: "mandatory",
                sourceServiceRevisionId: null,
            })
        }
    }

    for (const service of orderOnboardingServices(input.services)) {
        for (const assignment of [...service.modules].sort((left, right) => left.sortOrder - right.sortOrder)) {
            if (selected.has(assignment.moduleId)) continue
            const moduleDefinition = moduleById.get(assignment.moduleId)
            if (moduleDefinition?.status === "published" && moduleDefinition.revisionId) {
                selected.set(moduleDefinition.id, {
                    moduleId: moduleDefinition.id,
                    sourceKind: "service",
                    sourceServiceRevisionId: service.revisionId,
                })
            }
        }
    }

    return [...selected.values()]
}
