import { SERVICES } from "./services"
import {
    buildRelationshipDealServiceOptionsCore,
    relationshipFulfilmentServiceDefinitionCore,
    relationshipServiceDisplayNameCore,
} from "./service-display-core"
import type {
    OnboardingServiceRevisionDisplay,
    StoredRelationshipService,
} from "./service-display-core"

export type {
    OnboardingServiceRevisionDisplay,
    RelationshipDealServiceOption,
    StoredRelationshipService,
} from "./service-display-core"

export function relationshipServiceDisplayName(
    service: Pick<StoredRelationshipService, "service_key" | "service_revision_id">,
    revisions: ReadonlyMap<string, OnboardingServiceRevisionDisplay>,
) {
    return relationshipServiceDisplayNameCore(service, revisions, SERVICES)
}

export function relationshipFulfilmentServiceDefinition(serviceKey: string, immutableRevisionName?: string | null) {
    return relationshipFulfilmentServiceDefinitionCore(serviceKey, immutableRevisionName, SERVICES)
}

export function buildRelationshipDealServiceOptions(input: Parameters<typeof buildRelationshipDealServiceOptionsCore>[0]) {
    return buildRelationshipDealServiceOptionsCore(input, SERVICES)
}
