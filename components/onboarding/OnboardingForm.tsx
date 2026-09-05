"use client"

import { FormEvent, useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
    prepareDirectUploads,
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
import { useOnboardingSaveCoordinator, useOnboardingSaveTask } from "@/components/onboarding/OnboardingSaveCoordinator"
import { RequestHelpLink } from "@/components/onboarding/RequestHelpLink"

type OnboardingFormProps = {
    token: string
    stepKey: string
    sessionStepId?: string | null
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
    onSubmittingChange?: (submitting: boolean) => void
}

type UploadTask = {
    id: string
    fieldName: string
    file: File
    status: "preparing" | "uploading" | "uploaded" | "error"
    progress: number
    storedUpload?: StoredUpload
    error?: string
    promise?: Promise<void>
}

function uploadId(fieldName: string, file: File) {
    return `${fieldName}:${file.name}:${file.size}:${file.lastModified}`
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
    sessionStepId,
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
    onSubmittingChange,
}: OnboardingFormProps) {
    const router = useRouter()
    const { flushAll } = useOnboardingSaveCoordinator()
    const formRef = useRef<HTMLFormElement>(null)
    const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const draftQueueRef = useRef<{ version: number; response: FormResponse } | null>(null)
    const draftPumpRef = useRef<Promise<void> | null>(null)
    const draftVersionRef = useRef(0)
    const mountedRef = useRef(true)
    const submittingRef = useRef(false)
    const selectedFilesRef = useRef<Record<string, File[]>>({})
    const uploadTasksRef = useRef(new Map<string, UploadTask>())
    const [error, setError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [uploadStateById, setUploadStateById] = useState<Record<string, {
        status: UploadTask["status"]
        progress: number
        error?: string
    }>>({})
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
                const uploadedFiles = (selectedFilesRef.current[field.name] ?? []).flatMap((file) => {
                    const storedUpload = uploadTasksRef.current.get(uploadId(field.name, file))?.storedUpload
                    return storedUpload ? [storedUpload] : []
                })
                response[field.name] = [
                    ...getStoredFiles(initialResponse, field.name),
                    ...uploadedFiles,
                ]
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
        try {
            window.localStorage.setItem(localDraftKey, JSON.stringify(response))
        } catch {
            // Server autosave remains authoritative when local storage is unavailable.
        }
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
                    const outcome = await saveStepDraft(token, stepKey, pending.response, sessionStepId)
                    succeeded = outcome.ok && outcome.saved
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
    }, [locked, preview, sessionStepId, stepKey, token])

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

    const scheduleDraftSave = useCallback((immediate = false) => {
        if (locked || submittingRef.current) return
        const response = responseFromForm()
        if (preview) {
            setDraftStatus("saved")
            return
        }
        queueDraft(response)
        if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
        if (immediate) {
            void flushDraftQueue()
            return
        }
        draftTimerRef.current = setTimeout(() => {
            draftTimerRef.current = null
            void flushDraftQueue()
        }, 500)
    }, [flushDraftQueue, locked, preview, queueDraft, responseFromForm])

    const publishUploadState = useCallback(() => {
        if (!mountedRef.current) return
        setUploadStateById(Object.fromEntries([...uploadTasksRef.current].map(([id, task]) => [id, {
            status: task.status,
            progress: task.progress,
            error: task.error,
        }])))
    }, [])

    const startBackgroundUploads = useCallback((fieldName: string, files: File[]) => {
        if (locked || preview || files.length === 0) return
        const freshTasks = files.flatMap((file) => {
            const id = uploadId(fieldName, file)
            const existing = uploadTasksRef.current.get(id)
            if (existing && existing.status !== "error") return []
            const task: UploadTask = {
                id,
                fieldName,
                file,
                status: "preparing",
                progress: 0,
            }
            uploadTasksRef.current.set(id, task)
            return [task]
        })
        if (freshTasks.length === 0) return
        publishUploadState()

        const batch = (async () => {
            let prepared: Awaited<ReturnType<typeof prepareDirectUploads>>
            try {
                prepared = await prepareDirectUploads(token, stepKey, freshTasks.map((task) => ({
                    clientId: task.id,
                    fieldName: task.fieldName,
                    file: {
                        name: task.file.name,
                        size: task.file.size,
                        type: task.file.type,
                    },
                })))
            } catch (caughtError) {
                const message = caughtError instanceof Error ? caughtError.message : "Could not prepare this upload."
                for (const task of freshTasks) {
                    task.status = "error"
                    task.error = message
                    task.promise = undefined
                }
                publishUploadState()
                return
            }

            await Promise.all(prepared.map(async (upload) => {
                const task = uploadTasksRef.current.get(upload.clientId)
                if (!task) return
                task.status = "uploading"
                publishUploadState()
                try {
                    await uploadFileToSignedUrl(upload.uploadUrl, task.file, (progress) => {
                        if (task.progress === progress) return
                        task.progress = progress
                        publishUploadState()
                    })
                    task.status = "uploaded"
                    task.progress = 100
                    task.storedUpload = upload.storedUpload
                    task.error = undefined
                } catch (caughtError) {
                    task.status = "error"
                    task.error = caughtError instanceof Error ? caughtError.message : "Upload failed. Please try again."
                }
                publishUploadState()
            }))

            for (const task of freshTasks) task.promise = undefined
            if (freshTasks.some((task) => task.status === "uploaded")) scheduleDraftSave(true)
            publishUploadState()
        })()

        for (const task of freshTasks) task.promise = batch
    }, [locked, preview, publishUploadState, scheduleDraftSave, stepKey, token])

    const updateSelectedFiles = useCallback((fieldName: string, files: File[]) => {
        const next = { ...selectedFilesRef.current, [fieldName]: files }
        selectedFilesRef.current = next
        setSelectedFilesByField(next)
        startBackgroundUploads(fieldName, files)
        scheduleDraftSave()
    }, [scheduleDraftSave, startBackgroundUploads])

    const waitForCurrentUploads = useCallback(async () => {
        for (const [fieldName, files] of Object.entries(selectedFilesRef.current)) {
            const retryable = files.filter((file) => {
                const task = uploadTasksRef.current.get(uploadId(fieldName, file))
                return !task || task.status === "error"
            })
            startBackgroundUploads(fieldName, retryable)
        }

        const currentTasks = Object.entries(selectedFilesRef.current).flatMap(([fieldName, files]) =>
            files.flatMap((file) => {
                const task = uploadTasksRef.current.get(uploadId(fieldName, file))
                return task ? [task] : []
            }))
        await Promise.all([...new Set(currentTasks.flatMap((task) => task.promise ? [task.promise] : []))])
        const failed = currentTasks.find((task) => task.status !== "uploaded")
        if (failed) throw new Error(failed.error ?? `${failed.file.name} has not finished uploading.`)
    }, [startBackgroundUploads])

    const flushCurrentDraft = useCallback(async () => {
        if (locked || preview || submittingRef.current) return
        await waitForCurrentUploads()
        if (draftTimerRef.current) {
            clearTimeout(draftTimerRef.current)
            draftTimerRef.current = null
        }
        queueDraft(responseFromForm())
        await flushDraftQueue()
        if (draftQueueRef.current && navigator.onLine) await flushDraftQueue()
        if (draftQueueRef.current) throw new Error("Your latest changes have not saved yet. Check your connection and try again.")
    }, [flushDraftQueue, locked, preview, queueDraft, responseFromForm, waitForCurrentUploads])

    useOnboardingSaveTask(`form:${sessionStepId ?? stepKey}`, flushCurrentDraft)

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (submittingRef.current) return
        setError(null)
        if (preview) {
            setDraftStatus("saved")
            onPreviewSubmit?.()
            if (previewNextHref) router.push(previewNextHref)
            return
        }

        submittingRef.current = true
        setSaving(true)
        onSubmittingChange?.(true)

        if (draftTimerRef.current) {
            clearTimeout(draftTimerRef.current)
            draftTimerRef.current = null
        }
        await draftPumpRef.current
        draftQueueRef.current = null

        try {
            await flushAll()
            await waitForCurrentUploads()
            const response = responseFromForm()
            for (const field of form.fields) {
                const value = response[field.name]
                if (field.type !== "file" && typeof value === "string") {
                    response[field.name] = value.trim()
                }
            }

            const outcome = await submitPreparedFormStep(token, stepKey, response)
            if (!outcome.ok) throw new Error(outcome.error)
            window.localStorage.removeItem(localDraftKey)
            if (outcome.clientPortalUrl) {
                window.location.assign(outcome.clientPortalUrl)
                return
            }
            setSelectedFilesByField({})
            selectedFilesRef.current = {}
            router.replace(outcome.nextPath)
        } catch (caughtError) {
            submittingRef.current = false
            setSaving(false)
            onSubmittingChange?.(false)
            setError(
                caughtError instanceof Error
                    ? caughtError.message
                    : "Something went wrong while uploading. Please try again."
            )
        }
    }

    const submitting = saving

    return (
        <form
            id={formId}
            ref={formRef}
            onSubmit={handleSubmit}
            onInput={() => scheduleDraftSave()}
            data-global-loading="false"
            aria-busy={submitting}
            className="mt-6 space-y-5 sm:mt-8 sm:space-y-6"
        >
            {showIntro ? <div className="rounded-2xl border border-black/10 bg-[var(--onboarding-page,#F8F7F3)] p-4 sm:p-5">
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
                            readOnly={locked || submitting}
                            className="mt-3 min-h-28 w-full rounded-xl border border-black/20 bg-[var(--onboarding-surface,#FFFFFF)] px-3.5 py-3 text-base text-[var(--onboarding-text,#0F172A)] outline-none transition focus:border-[var(--onboarding-primary,#1E3A5F)] focus:ring-4 focus:ring-black/5 sm:min-h-32 sm:rounded-2xl sm:px-4"
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
                                disabled={submitting}
                                uploadStates={(selectedFilesByField[field.name] ?? []).map((file) => {
                                    if (preview) return { status: "uploaded" as const, progress: 100 }
                                    return uploadStateById[uploadId(field.name, file)]
                                        ?? { status: "preparing" as const, progress: 0 }
                                })}
                                onRetry={(index) => {
                                    const file = selectedFilesRef.current[field.name]?.[index]
                                    if (file) startBackgroundUploads(field.name, [file])
                                }}
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
                            readOnly={locked || submitting}
                            className="mt-3 min-h-12 w-full rounded-xl border border-black/20 bg-[var(--onboarding-surface,#FFFFFF)] px-3.5 py-3 text-base text-[var(--onboarding-text,#0F172A)] outline-none transition focus:border-[var(--onboarding-primary,#1E3A5F)] focus:ring-4 focus:ring-black/5 sm:rounded-2xl sm:px-4"
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

            {error ? <p role="alert" className="text-left text-sm text-red-700">{error} <RequestHelpLink />.</p> : null}

            {locked && allowEditRequest ? (
                <div>
                    <button
                        type="button"
                        disabled={editRequestStatus === "saving" || editRequestStatus === "saved"}
                        onClick={() => {
                            setEditRequestStatus("saving")
                            void requestStepEdit(token, stepKey).then((outcome) => setEditRequestStatus(outcome.ok ? "saved" : "error"))
                        }}
                        className="min-h-14 w-full rounded-xl border border-[var(--onboarding-primary,#1E3A5F)] px-5 py-4 font-medium leading-6 text-[var(--onboarding-primary,#1E3A5F)] disabled:opacity-60"
                    >
                        {editRequestStatus === "saved" ? "Edit request recorded" : editRequestStatus === "saving" ? "Recording request…" : "Request to edit"}
                    </button>
                    {editRequestStatus === "error" ? <p className="mt-2 text-sm text-red-700">Could not record your request. Please try again.</p> : null}
                </div>
            ) : locked ? (
                <p className="text-center text-sm text-[var(--onboarding-muted,#475569)]">This submitted step is read-only.</p>
            ) : hideSubmit ? (
                <p aria-live="polite" className="text-center text-xs text-[var(--onboarding-muted,#475569)]">
                    {draftStatus === "saving" ? "Saving changes…" : draftStatus === "saved" ? "All changes saved" : draftStatus === "error" ? "Changes will retry when you reconnect" : ""}
                </p>
            ) : (
                <>
                    <p aria-live="polite" className="text-center text-xs text-[var(--onboarding-muted,#475569)]">
                        {draftStatus === "saving" ? "Saving changes…" : draftStatus === "saved" ? "All changes saved" : draftStatus === "error" ? "Changes will retry when you reconnect" : ""}
                    </p>
                    <button
                        disabled={submitting || submitDisabled}
                        className="min-h-14 w-full rounded-xl bg-[var(--onboarding-primary,#1E3A5F)] px-5 py-4 font-medium leading-6 text-white transition active:scale-[0.99] active:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {submitting ? "Saving…" : submitLabel}
                    </button>
                </>
            )}
        </form>
    )
}
