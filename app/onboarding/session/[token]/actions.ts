"use server"

import {
    getOnboardingForm,
    OnboardingFormDefinition,
    FormResponse,
    validateOnboardingUploadFile,
} from "@/lib/onboarding/forms"
import {
    completeCanonicalStep,
    getCanonicalSessionByToken,
    getPublicOnboardingPath,
    markCanonicalSessionNoticeSeen,
    ONBOARDING_SESSION_UPDATED_MESSAGE,
    requestCanonicalStepEdit,
    saveCanonicalStepDraft,
    submitCanonicalFormStep,
} from "@/lib/onboarding/canonical"
import { createSignedRelationshipOnboardingUpload } from "@/lib/onboarding/uploads"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { redirect } from "next/navigation"

async function getPublicSession(token: string) {
    const session = await getCanonicalSessionByToken(token)
    if (!session) throw new Error("Invalid onboarding session")
    return session
}

function createFillerResponse(form: OnboardingFormDefinition): FormResponse {
    const response: FormResponse = {}

    for (const field of form.fields) {
        if (field.type === "file") {
            response[field.name] = []
            continue
        }

        response[field.name] = `Test response for ${field.label}.`
    }

    return response
}

export async function completeStep(token: string, stepKey: string) {
    const outcome = await completeCanonicalStep(token, stepKey)
    if (outcome.clientPortalUrl) redirect(outcome.clientPortalUrl)
}

export async function satisfyBlockRequirement(token: string, sessionBlockId: string, kind: "button_opened" | "video_finished") {
    try {
        const resolved = await getPublicSession(token)
        if (resolved.session.status !== "active") throw new Error("This onboarding session is read-only")
        const { data, error } = await supabaseAdmin.rpc("satisfy_onboarding_block_requirement", {
            p_token: token,
            p_session_block_id: sessionBlockId,
            p_requirement_kind: kind,
        })
        if (error) throw new Error(error.message)
        return { ok: true as const, data }
    } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error.message : "Could not record the required action." }
    }
}

export async function prepareDirectUpload(
    token: string,
    stepKey: string,
    fieldName: string,
    file: {
        name: string
        size: number
        type: string
    }
) {
    const resolved = await getPublicSession(token)
    if (resolved.session.status !== "active") throw new Error("This onboarding session is read-only")
    const stepIndex = resolved.completableSteps.findIndex((candidate) => candidate.key === stepKey)
    const step = resolved.completableSteps[stepIndex]
    const form = step?.form ?? getOnboardingForm(step?.formKey)
    const field = form?.fields.find((candidate) => candidate.name === fieldName)
    if (!step && resolved.usesSnapshot) throw new Error(ONBOARDING_SESSION_UPDATED_MESSAGE)
    if (!step || step.kind !== "form" || !field || field.type !== "file") throw new Error("Unknown upload field")
    if (resolved.completedKeys.has(step.key)) throw new Error("Submitted steps are locked")
    const firstIncompleteIndex = resolved.completableSteps.findIndex((candidate) => !resolved.completedKeys.has(candidate.key))
    if (stepIndex !== firstIncompleteIndex) throw new Error("Complete the earlier onboarding step first.")
    validateOnboardingUploadFile(field, file)
    return createSignedRelationshipOnboardingUpload(
        resolved.session.workspace_id,
        resolved.session.relationship_id,
        resolved.session.id,
        stepKey,
        file
    )
}

export async function submitPreparedFormStep(
    token: string,
    stepKey: string,
    response: FormResponse
) {
    try {
        const outcome = await submitCanonicalFormStep(token, stepKey, response)
        return { ok: true as const, clientPortalUrl: outcome.clientPortalUrl }
    } catch (error) {
        return {
            ok: false as const,
            error: error instanceof Error ? error.message : "Could not save this onboarding step.",
        }
    }
}

export async function saveStepDraft(token: string, stepKey: string, response: FormResponse) {
    try {
        return { ok: true as const, ...(await saveCanonicalStepDraft(token, stepKey, response)) }
    } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error.message : "Could not save this draft." }
    }
}

export async function requestStepEdit(token: string, stepKey: string) {
    try {
        return { ok: true as const, ...(await requestCanonicalStepEdit(token, stepKey)) }
    } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error.message : "Could not record your request." }
    }
}

export async function markSessionNoticeSeen(token: string, noticeId: string) {
    try {
        return { ok: true as const, ...(await markCanonicalSessionNoticeSeen(token, noticeId)) }
    } catch {
        return { ok: false as const }
    }
}

export async function skipTestStep(
    token: string,
    stepKey: string,
    formKey?: string
) {
    try {
        const { session } = await getPublicSession(token)
        if (!session.is_test) throw new Error("Invalid test onboarding session")

        if (formKey) {
            const step = (await getPublicSession(token)).completableSteps.find((candidate) => candidate.key === stepKey)
            const form = step?.form ?? getOnboardingForm(formKey)
            if (form) {
                const outcome = await submitCanonicalFormStep(token, stepKey, createFillerResponse(form))
                return { ok: true as const, nextPath: outcome.clientPortalUrl ?? await getPublicOnboardingPath(token) }
            }
        }

        const outcome = await completeCanonicalStep(token, stepKey)
        return { ok: true as const, nextPath: outcome.clientPortalUrl ?? await getPublicOnboardingPath(token) }
    } catch (error) {
        return {
            ok: false as const,
            error: error instanceof Error ? error.message : "Could not skip this test step.",
        }
    }
}
