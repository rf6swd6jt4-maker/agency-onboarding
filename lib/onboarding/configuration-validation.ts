import { randomUUID } from "crypto"
import type { OnboardingModuleDefinition, OnboardingServiceDefinition } from "@/lib/onboarding/configuration-types"

const fieldTypes = new Set(["text", "email", "tel", "url", "textarea", "file"])
const fileAcceptTypes = new Set(["image", "video", "document", "any"])

function cleanText(value: unknown, maximum: number) {
    return String(value ?? "").trim().slice(0, maximum)
}

function stableId(value: unknown) {
    const id = String(value ?? "").trim()
    return id || randomUUID()
}

function codeFromId(id: string, prefix: string) {
    return `${prefix}-${id.replace(/[^a-zA-Z0-9]/g, "").slice(-12).toLowerCase()}`
}

export function isAllowedOnboardingVideoUrl(value: string) {
    if (!value) return true
    try {
        const url = new URL(value)
        if (url.protocol !== "https:") return false
        const hostname = url.hostname.toLowerCase().replace(/^www\./, "")
        if (["youtube.com", "youtu.be", "vimeo.com", "loom.com"].some((host) => hostname === host || hostname.endsWith(`.${host}`))) return true
        return /\.(mp4|webm|mov|m4v)(?:$|\?)/i.test(`${url.pathname}${url.search}`)
    } catch {
        return false
    }
}

export function isScopedBuilderVideoPath(
    value: string | null | undefined,
    workspaceId: string,
    moduleId: string,
    revisionId: string | null | undefined
) {
    if (!value) return true
    if (!revisionId || value !== value.trim() || value.includes("\\") || /[\u0000-\u001f\u007f]/u.test(value)) return false
    const segments = value.split("/")
    return segments.length === 5
        && segments[0] === workspaceId
        && segments[1] === "onboarding-builder"
        && segments[2] === moduleId
        && segments[3] === revisionId
        && Boolean(segments[4])
        && segments.every((segment) => segment !== "." && segment !== "..")
}

export function defaultOnboardingModuleDefinition(): Omit<OnboardingModuleDefinition, "id" | "revisionId" | "code" | "status" | "version" | "lastEditedAt" | "lastEditedBy"> {
    const stepId = randomUUID()
    const fieldId = randomUUID()
    return {
        name: "Untitled module",
        description: "",
        isTest: false,
        sortOrder: 1_000_000,
        steps: [{
            id: stepId,
            key: codeFromId(stepId, "step"),
            kind: "form",
            title: "New form step",
            description: "",
            estimatedTime: "2–3 minutes",
            why: "",
            videoUrl: "",
            videoPath: null,
            fields: [{
                id: fieldId,
                key: codeFromId(fieldId, "field"),
                label: "Short answer",
                type: "text",
                required: false,
                helpText: "",
                placeholder: "",
                accept: "any",
                multiple: false,
            }],
        }],
    }
}

export function normalizeModuleDefinition(input: unknown) {
    const value = input && typeof input === "object" ? input as Partial<OnboardingModuleDefinition> : {}
    const name = cleanText(value.name, 120)
    if (!name) return { ok: false as const, error: "Give this module a name before saving." }
    const rawSteps = Array.isArray(value.steps) ? value.steps : []
    if (!rawSteps.length) return { ok: false as const, error: "A module must contain at least one step." }
    const seenStepIds = new Set<string>()
    const steps = rawSteps.map((rawStep, stepIndex) => {
        const source = rawStep && typeof rawStep === "object" ? rawStep : {} as typeof rawStep
        const id = stableId(source.id)
        if (seenStepIds.has(id)) throw new Error("Each step must have a stable unique ID.")
        seenStepIds.add(id)
        const kind = source.kind === "video" ? "video" as const : "form" as const
        const videoUrl = cleanText(source.videoUrl, 2_000)
        if (kind === "video" && videoUrl && !isAllowedOnboardingVideoUrl(videoUrl)) throw new Error("Use a Loom, YouTube, Vimeo, or direct HTTPS video URL.")
        const seenFieldIds = new Set<string>()
        const fields = kind === "form" ? (Array.isArray(source.fields) ? source.fields : []).map((rawField, fieldIndex) => {
            const field = rawField && typeof rawField === "object" ? rawField : {} as typeof rawField
            const fieldId = stableId(field.id)
            if (seenFieldIds.has(fieldId)) throw new Error("Each field in a step must have a stable unique ID.")
            seenFieldIds.add(fieldId)
            const type = fieldTypes.has(String(field.type)) ? field.type : "text"
            return {
                id: fieldId,
                key: cleanText(field.key, 120) || codeFromId(fieldId, "field"),
                label: cleanText(field.label, 160) || `Field ${fieldIndex + 1}`,
                type,
                required: Boolean(field.required),
                helpText: cleanText(field.helpText, 1_000),
                placeholder: cleanText(field.placeholder, 500),
                accept: fileAcceptTypes.has(String(field.accept)) ? field.accept : "any",
                multiple: type === "file" ? field.multiple !== false : false,
            }
        }) : []
        return {
            id,
            key: cleanText(source.key, 120) || codeFromId(id, "step"),
            kind,
            title: cleanText(source.title, 160) || `Step ${stepIndex + 1}`,
            description: cleanText(source.description, 4_000),
            estimatedTime: cleanText(source.estimatedTime, 80),
            why: cleanText(source.why, 2_000),
            videoUrl: kind === "video" ? videoUrl : "",
            videoPath: kind === "video" ? cleanText(source.videoPath, 2_000) || null : null,
            fields,
        }
    })
    return { ok: true as const, definition: { name, description: cleanText(value.description, 2_000), isTest: Boolean(value.isTest), steps } }
}

export function normalizeServiceDefinition(input: unknown) {
    const value = input && typeof input === "object" ? input as Partial<OnboardingServiceDefinition> : {}
    const name = cleanText(value.name, 120)
    if (!name) return { ok: false as const, error: "Give this service a name before saving." }
    const defaultPriceCents = Number(value.defaultPriceCents)
    if (!Number.isSafeInteger(defaultPriceCents) || defaultPriceCents < 0) return { ok: false as const, error: "Enter a valid default price." }
    const currency = cleanText(value.currency, 3).toUpperCase()
    if (!/^[A-Z]{3}$/.test(currency)) return { ok: false as const, error: "Use a three-letter currency code, such as USD." }
    const moduleIds = (Array.isArray(value.modules) ? value.modules : []).map((module) => String(module.moduleId ?? "")).filter(Boolean)
    if (new Set(moduleIds).size !== moduleIds.length) return { ok: false as const, error: "A service cannot contain the same module twice." }
    return {
        ok: true as const,
        definition: {
            name,
            description: cleanText(value.description, 4_000),
            defaultPriceCents,
            currency,
            defaultAssigneeUserId: cleanText(value.defaultAssigneeId, 120) || null,
            isTest: Boolean(value.isTest),
            displayPriority: Math.max(0, Math.min(10_000, Math.round(Number(value.displayPriority) || 0))),
            moduleIds,
        },
    }
}
