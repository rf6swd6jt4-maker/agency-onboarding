import type { OnboardingBillingInterval, OnboardingServiceType } from "@/lib/onboarding/configuration-types"

export type ServiceTemplateSetup =
    | { kind: "none" }
    | { kind: "connection"; connectionKey: string }

export type ServiceTemplateDefinition = {
    id: string
    name: string
    description: string
    thumbnail: {
        src: string
        alt: string
    }
    serviceDefaults: {
        name: string
        description: string
        thumbnailSrc: string
        serviceType: OnboardingServiceType
        defaultBillingInterval: OnboardingBillingInterval
        defaultBillingIntervalCount: number
    }
    setup: ServiceTemplateSetup
}

const metaAdsThumbnail = "/service-templates/meta-ads.png"

export const SERVICE_TEMPLATES: readonly ServiceTemplateDefinition[] = [{
    id: "meta-ads",
    name: "Meta Ads",
    description: "Plan, launch, and manage paid campaigns across Facebook and Instagram.",
    thumbnail: {
        src: metaAdsThumbnail,
        alt: "Meta Ads service cover",
    },
    serviceDefaults: {
        name: "Meta Ads",
        description: "Plan, launch, and manage paid campaigns across Facebook and Instagram.",
        thumbnailSrc: metaAdsThumbnail,
        serviceType: "retainer",
        defaultBillingInterval: "month",
        defaultBillingIntervalCount: 1,
    },
    setup: { kind: "none" },
}]
