"use client"

import { FormEvent, useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
    prepareDirectUpload,
    requestStepEdit,
    saveStepDraft,
    submitPreparedFormStep,
} from "@/app/onboarding/session/[token]/actions"
import {
    FormResponse,
    getFileAcceptValue,
    OnboardingFormDefinition,
    StoredUpload,
} from "@/lib/onboarding/forms"
import { FileUploadField } from "@/components/onboarding/FileUploadField"
import { LoadingOverlay } from "@/components/LoadingOverlay"

type OnboardingFormProps = {
    token: string
    stepKey: string
    form: OnboardingFormDefinition
    initialResponse?: FormResponse
    locked?: boolean
    allowEditRequest?: boolean
    preview?: boolean
    previewNextHref?: string | null
    onPreviewSubmit?: () => void
    submitDisabled?: boolean
    submitLabel?: string
    showIntro?: boolean
    formId?: string
    hideSubmit?: boolean
}

function getStringValue(response: FormResponse | undefined, name: string) {
    const value = response?.[name]

    return typeof value === "string" ? value : ""
}

function getStoredFiles(response: FormResponse | undefined, name: string) {
    const value = response?.[name]

    return Array.isArray(value) ? (value as StoredUpload[]) : []
}

function uploadFileToSignedUrl(
    uploadUrl: string,
    file: File,
    onProgress: (percentage: number) => void
) {
    return new Promise<void>((resolve, reject) => {
        const request = new XMLHttpRequest()

        request.upload.addEventListener("progress", (event) => {
            if (event.lengthComputable) {
                onProgress(Math.round((event.loaded / event.total) * 100))
            }
        })

        request.addEventListener("load", () => {
            if (request.status >= 200 && request.status < 300) {
                onProgress(100)
                resolve()
                return
            }

            reject(new Error(`Upload failed with status ${request.status}`))
        })

        request.addEventListener("error", () => {
            reject(new Error("Upload failed. Check your connection and try again."))
        })

        request.open("PUT", uploadUrl)
        request.setRequestHeader(
            "Content-Type",
            file.type || "application/octet-stream"
        )
        request.send(file)
    })
}

export function OnboardingForm({
    token,
    stepKey,
    form,
    initialResponse,
    locked = false,
    allowEditRequest = false,
    preview = false,
    previewNextHref,
    onPreviewSubmit,
    submitDisabled = false,
    submitLabel = "Save and continue",
    showIntro = true,
    formId,
    hideSubmit = false,
}: OnboardingFormProps) {
    const router = useRouter()
    const formRef = useRef<HTMLFormElement>(null)
    const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const draftQueueRef = useRef<{ version: number; response: FormResponse } | null>(null)
    const draftPumpRef = useRef<Promise<void> | null>(null)
    const draftVersionRef = useRef(0)
    const mountedRef = useRef(true)
    const [error, setError] = useState<string | null>(null)
    const [uploadLabel, setUploadLabel] = useState<string | null>(null)
    const [uploadProgress, setUploadProgress] = useState(0)
    const [saving, setSaving] = useState(false)
    const [draftStatus, setDraftStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
    const [editRequestStatus, setEditRequestStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
    const [selectedFilesByField, setSelectedFilesByField] = useState<
        Record<string, File[]>
    >({})
    const localDraftKey = `betelgeze:onboarding-draft:${token}:${stepKey}`

    useEffect(() => {
        mountedRef.current = true
        return () => {
            mountedRef.current = false
            if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
        }
    }, [])

    const responseFromForm = useCallback(() => {
        const response: FormResponse = {}
        const formElement = formRef.current
        if (!formElement) return response
        const formData = new FormData(formElement)
        for (const field of form.fields) {
            if (field.type === "file") {
                response[field.name] = getStoredFiles(initialResponse, field.name)
            } else {
                response[field.name] = String(formData.get(field.name) ?? "")
            }
        }
        return response
    }, [form.fields, initialResponse])

    const queueDraft = useCallback((response: FormResponse) => {
        const version = draftVersionRef.current + 1
        draftVersionRef.current = version
        draftQueueRef.current = { version, response }
        window.localStorage.setItem(localDraftKey, JSON.stringify(response))
        setDraftStatus("saving")
    }, [localDraftKey])

    const flushDraftQueue = useCallback(() => {
        if (locked || preview) return Promise.resolve()
        if (draftPumpRef.current) return draftPumpRef.current

        const pump = (async () => {
            while (draftQueueRef.current) {
                if (!navigator.onLine) {
                    if (mountedRef.current) setDraftStatus("error")
                    return
                }

                const pending = draftQueueRef.current
                draftQueueRef.current = null
                if (mountedRef.current) setDraftStatus("saving")

                let succeeded = false
                try {
                    const outcome = await saveStepDraft(token, stepKey, pending.response)
                    succeeded = outcome.ok
                } catch {
                    succeeded = false
                }

                if (!succeeded) {
                    const queuedAfterFailure = draftQueueRef.current as {
                        version: number
                        response: FormResponse
                    } | null
                    if (!queuedAfterFailure || queuedAfterFailure.version < pending.version) {
                        draftQueueRef.current = pending
                    }
                    if (mountedRef.current) setDraftStatus("error")
                    return
                }

                if (
                    mountedRef.current &&
                    !draftQueueRef.current &&
                    draftVersionRef.current === pending.version
                ) {
                    setDraftStatus("saved")
                }
            }
        })()

        draftPumpRef.current = pump
        const release = () => {
            if (draftPumpRef.current === pump) draftPumpRef.current = null
        }
        void pump.then(release, release)
        return pump
    }, [locked, preview, stepKey, token])

    useEffect(() => {
        if (locked || preview || !formRef.current) return
        try {
            const local = JSON.parse(window.localStorage.getItem(localDraftKey) ?? "{}") as FormResponse
            for (const field of form.fields) {
                if (field.type === "file" || typeof local[field.name] !== "string") continue
                const control = formRef.current.elements.namedItem(field.name)
                if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) control.value = local[field.name] as string
            }
        } catch {
            window.localStorage.removeItem(localDraftKey)
        }
        const retry = () => {
            queueDraft(responseFromForm())
            void flushDraftQueue()
        }
        window.addEventListener("online", retry)
        return () => window.removeEventListener("online", retry)
    }, [flushDraftQueue, form.fields, localDraftKey, locked, preview, queueDraft, responseFromForm])

    function scheduleDraftSave() {
        if (locked) return
        const response = responseFromForm()
        if (preview) {
            setDraftStatus("saved")
            return
        }
        queueDraft(response)
        if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
        draftTimerRef.current = setTimeout(() => void flushDraftQueue(), 800)
    }

    function updateSelectedFiles(fieldName: string, files: File[]) {
        setSelectedFilesByField((current) => ({
            ...current,
            [fieldName]: files,
        }))
    }

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setError(null)
        setUploadProgress(0)
        if (preview) {
            setDraftStatus("saved")
            onPreviewSubmit?.()
            if (previewNextHref) router.push(previewNextHref)
            return
        }

        if (draftTimerRef.current) {
            clearTimeout(draftTimerRef.current)
            draftTimerRef.current = null
        }
        draftQueueRef.current = null
        await draftPumpRef.current
        draftQueueRef.current = null

        const formData = new FormData(event.currentTarget)
        const response: FormResponse = {}

        try {
            for (const field of form.fields) {
                if (field.type === "file") {
                    const existingFiles = getStoredFiles(
                        initialResponse,
                        field.name
                    )
                    const files =
                        selectedFilesByField[field.name]?.filter(
                            (file) => file.size > 0 && Boolean(file.name)
                        ) ?? []

                    const uploadedFiles: StoredUpload[] = []

                    for (const [index, file] of files.entries()) {
                        setUploadLabel(
                            `Uploading ${file.name} (${index + 1} of ${files.length})`
                        )
                        setUploadProgress(0)

                        const prepared = await prepareDirectUpload(
                            token,
                            stepKey,
                            field.name,
                            {
                                name: file.name,
                                size: file.size,
                                type: file.type,
                            }
                        )

                        await uploadFileToSignedUrl(
                            prepared.uploadUrl,
                            file,
                            setUploadProgress
                        )

                        uploadedFiles.push(prepared.storedUpload)
                    }

                    response[field.name] = [...existingFiles, ...uploadedFiles]
                    continue
                }

                response[field.name] = String(
                    formData.get(field.name) ?? ""
                ).trim()
            }

            setUploadLabel("Saving your answers...")
            setSaving(true)

            const outcome = await submitPreparedFormStep(token, stepKey, response)
            if (!outcome.ok) throw new Error(outcome.error)
            window.localStorage.removeItem(localDraftKey)
            setUploadLabel(null)
            setUploadProgress(0)
            setSaving(false)
            setSelectedFilesByField({})
            router.refresh()
        } catch (caughtError) {
            setUploadLabel(null)
            setUploadProgress(0)
            setSaving(false)
            setError(
                caughtError instanceof Error
                    ? caughtError.message
                    : "Something went wrong while uploading. Please try again."
            )
        }
    }

    const submitting = saving || Boolean(uploadLabel)

    return (
        <form
            id={formId}
            ref={formRef}
            onSubmit={handleSubmit}
            onInput={scheduleDraftSave}
            data-global-loading="false"
            className="mt-8 space-y-6"
        >
            {submitting && <LoadingOverlay label="Saving your answers..." />}

            {showIntro ? <div className="rounded-2xl border border-black/10 bg-[var(--onboarding-page,#F8F7F3)] p-5">
                <p className="font-semibold text-[var(--onboarding-text,#0F172A)]">{form.title}</p>
                <p className="mt-2 text-sm leading-6 text-[var(--onboarding-muted,#475569)]">
                    {form.intro}
                </p>
            </div> : null}

            {form.fields.map((field) => (
                <div key={field.name}>
                    <label className="block text-base font-semibold text-[var(--onboarding-text,#0F172A)]">
                        {field.label}
                        {field.required && (
                            <span className="ml-1 text-red-500">*</span>
                        )}
                    </label>

                    {field.helpText && (
                        <p className="mt-1 text-sm leading-6 text-[var(--onboarding-muted,#475569)]">
                            {field.helpText}
                        </p>
                    )}

                    {field.type === "textarea" ? (
                        <textarea
                            name={field.name}
                            required={field.required}
                            defaultValue={getStringValue(
                                initialResponse,
                                field.name
                            )}
                            placeholder={field.placeholder}
                            readOnly={locked}
                            className="mt-3 min-h-32 w-full rounded-2xl border border-black/20 bg-[var(--onboarding-surface,#FFFFFF)] px-4 py-3 text-base text-[var(--onboarding-text,#0F172A)] outline-none transition focus:border-[var(--onboarding-primary,#1E3A5F)] focus:ring-4 focus:ring-black/5"
                        />
                    ) : field.type === "file" ? locked ? (
                        <div className="mt-3 rounded-xl bg-[var(--onboarding-page,#F8F7F3)] p-3 text-sm text-[var(--onboarding-muted,#475569)]">
                            {getStoredFiles(initialResponse, field.name).length} submitted file{getStoredFiles(initialResponse, field.name).length === 1 ? "" : "s"}.
                        </div>
                    ) : (
                        <div className="mt-3">
                            <FileUploadField
                                name={field.name}
                                accept={field.accept}
                                multiple={field.multiple}
                                required={field.required}
                                existingFiles={getStoredFiles(
                                    initialResponse,
                                    field.name
                                )}
                                files={selectedFilesByField[field.name] ?? []}
                                onFilesChange={(files) =>
                                    updateSelectedFiles(field.name, files)
                                }
                            />
                        </div>
                    ) : (
                        <input
                            name={field.name}
                            type={field.type}
                            required={field.required}
                            defaultValue={getStringValue(
                                initialResponse,
                                field.name
                            )}
                            placeholder={field.placeholder}
                            readOnly={locked}
                            className="mt-3 w-full rounded-2xl border border-black/20 bg-[var(--onboarding-surface,#FFFFFF)] px-4 py-3 text-base text-[var(--onboarding-text,#0F172A)] outline-none transition focus:border-[var(--onboarding-primary,#1E3A5F)] focus:ring-4 focus:ring-black/5"
                        />
                    )}

                    {field.type === "file" && (
                        <p className="mt-2 text-xs text-[var(--onboarding-muted,#475569)]">
                            Accepted:{" "}
                            {getFileAcceptValue(field.accept) ??
                                "images, videos, PDFs, and documents"}
                        </p>
                    )}
                </div>
            ))}

            {uploadLabel && (
                <div className="rounded-2xl border border-black/10 bg-[var(--onboarding-page,#F8F7F3)] p-4">
                    <div className="flex items-center justify-between gap-4 text-sm font-medium text-[var(--onboarding-primary,#1E3A5F)]">
                        <span>{uploadLabel}</span>
                        <span>{uploadProgress}%</span>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--onboarding-surface,#FFFFFF)]">
                        <div
                            className="h-full rounded-full bg-[var(--onboarding-primary,#1E3A5F)] transition-all"
                            style={{ width: `${uploadProgress}%` }}
                        />
                    </div>
                    <p className="mt-3 text-sm text-[var(--onboarding-muted,#475569)]">
                        Please keep this page open while your file uploads.
                    </p>
                </div>
            )}

            {error && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                    {error}
                </div>
            )}

            {locked && allowEditRequest ? (
                <div>
                    <button
                        type="button"
                        disabled={editRequestStatus === "saving" || editRequestStatus === "saved"}
                        onClick={() => {
                            setEditRequestStatus("saving")
                            void requestStepEdit(token, stepKey).then((outcome) => setEditRequestStatus(outcome.ok ? "saved" : "error"))
                        }}
                        className="w-full rounded-xl border border-[var(--onboarding-primary,#1E3A5F)] px-5 py-4 font-medium text-[var(--onboarding-primary,#1E3A5F)] disabled:opacity-60"
                    >
                        {editRequestStatus === "saved" ? "Edit request recorded" : editRequestStatus === "saving" ? "Recording request…" : "Request to edit"}
                    </button>
                    {editRequestStatus === "error" ? <p className="mt-2 text-sm text-red-700">Could not record your request. Please try again.</p> : null}
                </div>
            ) : locked ? (
                <p className="text-center text-sm text-[var(--onboarding-muted,#475569)]">This submitted step is read-only.</p>
            ) : hideSubmit ? (
                <p aria-live="polite" className="text-center text-xs text-[var(--onboarding-muted,#475569)]">
                    {draftStatus === "saving" ? "Saving draft…" : draftStatus === "saved" ? "Draft saved" : draftStatus === "error" ? "Draft will retry when you reconnect" : ""}
                </p>
            ) : (
                <>
                    <p aria-live="polite" className="text-center text-xs text-[var(--onboarding-muted,#475569)]">
                        {draftStatus === "saving" ? "Saving draft…" : draftStatus === "saved" ? "Draft saved" : draftStatus === "error" ? "Draft will retry when you reconnect" : ""}
                    </p>
                    <button
                        disabled={submitting || submitDisabled}
                        className="w-full rounded-xl bg-[var(--onboarding-primary,#1E3A5F)] px-5 py-4 font-medium text-white transition active:scale-[0.99] active:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {submitting ? "Uploading..." : submitLabel}
                    </button>
                </>
            )}
        </form>
    )
}
