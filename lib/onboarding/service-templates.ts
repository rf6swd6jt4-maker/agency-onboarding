import type { OnboardingBillingInterval, OnboardingServiceType } from "@/lib/onboarding/configuration-types"
import type { WorkspaceCapability } from "@/lib/workspace-capabilities"

export type ServiceTemplateSetup =
    | { kind: "none" }
    | { kind: "connection"; connectionKey: string }

export type ServiceTemplateOnboardingBlock = {
    kind: "connection" | "appointment_medium" | "appointment_fields"
    label: string
}

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
        recurringName: string
        recurringDescription: string
        defaultBillingInterval: OnboardingBillingInterval
        defaultBillingIntervalCount: number
    }
    setup: ServiceTemplateSetup
    capabilities: readonly WorkspaceCapability[]
    onboardingBlocks: readonly ServiceTemplateOnboardingBlock[]
}

const metaAdsThumbnail = "/service-templates/meta-ads.png"
const appointmentSettingThumbnail = "/service-templates/appointment-setting.png"

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
        recurringName: "Meta Ads management",
        recurringDescription: "Ongoing planning, launch, and management of paid campaigns across Facebook and Instagram.",
        defaultBillingInterval: "month",
        defaultBillingIntervalCount: 1,
    },
    setup: { kind: "connection", connectionKey: "meta_ads" },
    capabilities: ["onboarding.manage", "fulfilment.manage"],
    onboardingBlocks: [{ kind: "connection", label: "Facebook connection" }],
}, {
    id: "appointment-setting",
    name: "Appointment Setting",
    description: "Manage leads, setter availability, bookings, and appointment outcomes.",
    thumbnail: {
        src: appointmentSettingThumbnail,
        alt: "Appointment Setting service cover",
    },
    serviceDefaults: {
        name: "Appointment Setting",
        description: "Manage leads, setter availability, bookings, and appointment outcomes.",
        thumbnailSrc: appointmentSettingThumbnail,
        serviceType: "retainer",
        recurringName: "Appointment setting",
        recurringDescription: "Ongoing lead follow-up, booking, and appointment outcome management.",
        defaultBillingInterval: "month",
        defaultBillingIntervalCount: 1,
    },
    setup: { kind: "none" },
    capabilities: ["onboarding.manage", "fulfilment.manage", "appointment_setting.manage"],
    onboardingBlocks: [
        { kind: "appointment_medium", label: "Appointment medium" },
        { kind: "appointment_fields", label: "Appointment information" },
    ],
}]
