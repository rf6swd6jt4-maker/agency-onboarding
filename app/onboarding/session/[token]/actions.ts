"use server"

import {
    createTestFormResponse,
    getOnboardingForm,
    FormResponse,
    validateOnboardingUploadFile,
} from "@/lib/onboarding/forms"
import {
    completeCanonicalStep,
    getCanonicalSessionByToken,
    getCanonicalStepDraft,
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
import {
    normalizeAppointmentMediums,
    normalizeAppointmentRequestedFields,
    type AppointmentFieldKey,
    type AppointmentMedium,
} from "@/lib/appointment-setting"
import { normalizeCalendarResponse, validateCalendarSelection } from "@/lib/onboarding/calendar"

async function getPublicSession(token: string) {
    const session = await getCanonicalSessionByToken(token)
    if (!session) throw new Error("Invalid onboarding session")
    return session
}

async function onboardingPathForStep(token: string, stepKey: string | null) {
    const path = await getPublicOnboardingPath(token)
    return stepKey ? `${path}?step=${encodeURIComponent(stepKey)}` : path
}

export async function completeStep(token: string, stepKey: string) {
    const outcome = await completeCanonicalStep(token, stepKey)
    if (outcome.clientPortalUrl) redirect(outcome.clientPortalUrl)
}

export async function completePreparedStep(token: string, stepKey: string) {
    try {
        const outcome = await completeCanonicalStep(token, stepKey)
        return {
            ok: true as const,
            clientPortalUrl: outcome.clientPortalUrl,
            nextPath: outcome.clientPortalUrl ?? await onboardingPathForStep(token, outcome.nextStepKey),
        }
    } catch (error) {
        return {
            ok: false as const,
            error: error instanceof Error ? error.message : "Could not complete this onboarding step.",
        }
    }
}

export async function satisfyBlockRequirement(token: string, sessionBlockId: string, kind: "button_opened" | "video_finished") {
    try {
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

export async function configureAppointmentSettingBlock(
    token: string,
    sessionBlockId: string,
    kind: "appointment_medium" | "appointment_fields",
    input: { mediums?: AppointmentMedium[]; fields?: Array<{ key: AppointmentFieldKey; required: boolean }> },
) {
    try {
        let configuration: { mediums: AppointmentMedium[] } | { fields: Array<{ key: AppointmentFieldKey; required: boolean }> }
        if (kind === "appointment_medium") {
            const mediums = normalizeAppointmentMediums(input.mediums)
            if (mediums.length === 0) throw new Error("Choose at least one appointment option.")
            configuration = { mediums }
        } else {
            configuration = { fields: normalizeAppointmentRequestedFields(input.fields) }
        }
        const { data, error } = await supabaseAdmin.rpc("configure_appointment_setting_onboarding_block", {
            p_token: token,
            p_session_block_id: sessionBlockId,
            p_configuration: configuration,
        })
        if (error) throw new Error(error.message)
        return { ok: true as const, data }
    } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error.message : "Could not save the appointment preferences." }
    }
}

export async function saveCalendarBlockResponse(
    token: string,
    sessionBlockId: string,
    input: { date: string; time: string; timezone: string },
) {
    try {
        const selection = validateCalendarSelection(input)
        const { data, error } = await supabaseAdmin.rpc("submit_onboarding_calendar_block", {
            p_token: token,
            p_session_block_id: sessionBlockId,
            p_local_date: selection.date,
            p_local_time: selection.time,
            p_timezone: selection.timezone,
        })
        if (error) throw new Error(error.message)
        const response = normalizeCalendarResponse(data && typeof data === "object" && "response" in data
            ? (data as { response?: unknown }).response
            : null)
        if (!response) throw new Error("The saved date and time could not be confirmed. Please try again.")
        return { ok: true as const, response }
    } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error.message : "Could not save the date and time." }
    }
}

export async function prepareDirectUploads(
    token: string,
    stepKey: string,
    files: Array<{
        clientId: string
        fieldName: string
        file: { name: string; size: number; type: string }
    }>
) {
    if (files.length === 0) return []
    if (files.length > 25) throw new Error("Choose no more than 25 files at once.")
    const resolved = await getPublicSession(token)
    if (resolved.session.status !== "active") throw new Error("This onboarding session is read-only")
    const stepIndex = resolved.completableSteps.findIndex((candidate) => candidate.key === stepKey)
    const step = resolved.completableSteps[stepIndex]
    const form = step?.form ?? getOnboardingForm(step?.formKey)
    if (!step && resolved.usesSnapshot) throw new Error(ONBOARDING_SESSION_UPDATED_MESSAGE)
    if (!step || step.kind !== "form" || !form) throw new Error("Unknown upload field")
    if (resolved.completedKeys.has(step.key)) throw new Error("Submitted steps are locked")
    const firstIncompleteIndex = resolved.completableSteps.findIndex((candidate) => !resolved.completedKeys.has(candidate.key))
    if (stepIndex !== firstIncompleteIndex) throw new Error("Complete the earlier onboarding step first.")

    const countsByField = new Map<string, number>()
    const validated = files.map((candidate) => {
        const field = form.fields.find((item) => item.name === candidate.fieldName)
        if (!field || field.type !== "file") throw new Error("Unknown upload field")
        const count = (countsByField.get(field.name) ?? 0) + 1
        countsByField.set(field.name, count)
        if (!field.multiple && count > 1) throw new Error(`${field.label} accepts one file.`)
        validateOnboardingUploadFile(field, candidate.file)
        return candidate
    })

    return Promise.all(validated.map(async (candidate) => ({
        clientId: candidate.clientId,
        ...(await createSignedRelationshipOnboardingUpload(
            resolved.session.workspace_id,
            resolved.session.relationship_id,
            resolved.session.id,
            stepKey,
            candidate.file
        )),
    })))
}

export async function submitPreparedFormStep(
    token: string,
    stepKey: string,
    response: FormResponse
) {
    try {
        const outcome = await submitCanonicalFormStep(token, stepKey, response)
        return {
            ok: true as const,
            clientPortalUrl: outcome.clientPortalUrl,
            nextPath: outcome.clientPortalUrl ?? await onboardingPathForStep(token, outcome.nextStepKey),
        }
    } catch (error) {
        return {
            ok: false as const,
            error: error instanceof Error ? error.message : "Could not save this onboarding step.",
        }
    }
}

export async function saveStepDraft(
    token: string,
    stepKey: string,
    response: FormResponse,
    sessionStepId?: string | null,
) {
    try {
        if (sessionStepId) {
            const { data, error } = await supabaseAdmin.rpc("save_onboarding_step_draft", {
                p_token: token,
                p_session_step_id: sessionStepId,
                p_response: response,
            })
            if (!error) {
                return {
                    ok: true as const,
                    saved: true as const,
                    lockVersion: Number(data && typeof data === "object" && "lock_version" in data
                        ? (data as { lock_version?: unknown }).lock_version
                        : 1) || 1,
                }
            }
            if (error.code !== "42883" && error.code !== "PGRST202") throw new Error(error.message)
        }
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
    stepKey: string
) {
    try {
        const resolved = await getPublicSession(token)
        const { session } = resolved
        if (!session.is_test) throw new Error("Invalid test onboarding session")

        const step = resolved.completableSteps.find((candidate) => candidate.key === stepKey)
        if (step?.kind === "form") {
            const form = step.form ?? getOnboardingForm(step.formKey)
            if (form) {
                const draft = await getCanonicalStepDraft(token, stepKey)
                const response = createTestFormResponse(form, draft?.response)
                const outcome = await submitCanonicalFormStep(token, stepKey, response, {
                    allowMissingRequiredFilesForTest: true,
                })
                return { ok: true as const, nextPath: outcome.clientPortalUrl ?? await onboardingPathForStep(token, outcome.nextStepKey) }
            }
        }

        const outcome = await completeCanonicalStep(token, stepKey)
        return { ok: true as const, nextPath: outcome.clientPortalUrl ?? await onboardingPathForStep(token, outcome.nextStepKey) }
    } catch (error) {
        return {
            ok: false as const,
            error: error instanceof Error ? error.message : "Could not skip this test step.",
        }
    }
}
