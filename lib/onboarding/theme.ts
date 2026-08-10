import type { CSSProperties } from "react"
import type { OnboardingThemeDefinition, OnboardingThemeSlot } from "@/lib/onboarding/configuration-types"

export const DEFAULT_ONBOARDING_THEME: Record<OnboardingThemeSlot, string> = {
    primary: "#1E3A5F",
    accent: "#F0B429",
    pageBackground: "#F8F7F3",
    surface: "#FFFFFF",
    text: "#0F172A",
    mutedText: "#475569",
}
export const ONBOARDING_THEME_SLOT_LABELS: Record<OnboardingThemeSlot, string> = {
    primary: "Primary actions and links",
    accent: "Progress accent",
    pageBackground: "Page background",
    surface: "Cards and surfaces",
    text: "Main text",
    mutedText: "Muted text",
}

export function normalizeHexColour(value: unknown) {
    const text = String(value ?? "").trim().toUpperCase()
    if (/^#[0-9A-F]{6}$/.test(text)) return text
    if (/^#[0-9A-F]{3}$/.test(text)) return `#${text.slice(1).split("").map((part) => `${part}${part}`).join("")}`
    return null
}

export function resolveOnboardingTheme(theme?: OnboardingThemeDefinition | null) {
    const swatches = new Map((theme?.swatches ?? []).map((swatch) => [swatch.id, normalizeHexColour(swatch.hex)]))
    return (Object.keys(DEFAULT_ONBOARDING_THEME) as OnboardingThemeSlot[]).reduce<Record<OnboardingThemeSlot, string>>((resolved, slot) => {
        const assigned = theme?.assignments?.[slot]
        resolved[slot] = (assigned && swatches.get(assigned)) || DEFAULT_ONBOARDING_THEME[slot]
        return resolved
    }, { ...DEFAULT_ONBOARDING_THEME })
}

function rgb(hex: string) {
    const normalized = normalizeHexColour(hex) ?? "#000000"
    return [1, 3, 5].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255)
}

function luminance(hex: string) {
    const values = rgb(hex).map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722
}

export function colourContrastRatio(foreground: string, background: string) {
    const left = luminance(foreground)
    const right = luminance(background)
    return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05)
}

export function onboardingThemeWarnings(theme: OnboardingThemeDefinition) {
    const colours = resolveOnboardingTheme(theme)
    return [
        ["Main text on page background", colours.text, colours.pageBackground],
        ["Main text on cards", colours.text, colours.surface],
        ["Muted text on page background", colours.mutedText, colours.pageBackground],
        ["Primary action text", "#FFFFFF", colours.primary],
    ].flatMap(([label, foreground, background]) => {
        const ratio = colourContrastRatio(foreground, background)
        return ratio < 4.5 ? [`${label} has ${ratio.toFixed(1)}:1 contrast. Aim for at least 4.5:1.`] : []
    })
}

export function onboardingThemeStyle(theme?: OnboardingThemeDefinition | null) {
    const colours = resolveOnboardingTheme(theme)
    return {
        "--onboarding-primary": colours.primary,
        "--onboarding-accent": colours.accent,
        "--onboarding-page": colours.pageBackground,
        "--onboarding-surface": colours.surface,
        "--onboarding-text": colours.text,
        "--onboarding-muted": colours.mutedText,
    } as CSSProperties
}
