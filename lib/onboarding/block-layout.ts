import type { OnboardingBlockLayout } from "@/lib/onboarding/block-definition"

const widthClasses: Record<OnboardingBlockLayout["width"], string> = {
    narrow: "max-w-xl",
    standard: "max-w-2xl",
    wide: "max-w-4xl",
    full: "max-w-none",
}

const spacingBeforeClasses: Record<OnboardingBlockLayout["spacingBefore"], string> = {
    compact: "mt-3",
    normal: "mt-6",
    spacious: "mt-10",
}

const spacingAfterClasses: Record<OnboardingBlockLayout["spacingAfter"], string> = {
    compact: "mb-3",
    normal: "mb-6",
    spacious: "mb-10",
}

export function onboardingBlockLayoutClasses(layout: Partial<OnboardingBlockLayout> | null | undefined) {
    return [
        widthClasses[layout?.width ?? "standard"],
        spacingBeforeClasses[layout?.spacingBefore ?? "normal"],
        spacingAfterClasses[layout?.spacingAfter ?? "normal"],
        layout?.alignment === "center" ? "mx-auto text-center" : "mr-auto text-left",
    ].join(" ")
}
