import type { ReactNode } from "react"
import type { OnboardingThemeDefinition } from "@/lib/onboarding/configuration-types"
import { onboardingThemeStyle } from "@/lib/onboarding/theme"

export function OnboardingThemeProvider({ theme, children, className = "" }: { theme: OnboardingThemeDefinition; children: ReactNode; className?: string }) {
    return <div style={onboardingThemeStyle(theme)} className={className}>{children}</div>
}
