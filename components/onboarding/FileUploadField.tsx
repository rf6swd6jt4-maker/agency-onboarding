"use client"

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react"
import {
    FileAccept,
    getFileAcceptValue,
    StoredUpload,
} from "@/lib/onboarding/forms"

type FileUploadFieldProps = {
    name: string
    accept?: FileAccept
    multiple?: boolean
    required?: boolean
    existingFiles?: StoredUpload[]
    files: File[]
    disabled?: boolean
    uploadStates?: Array<{
        status: "preparing" | "uploading" | "uploaded" | "error"
        progress: number
        error?: string
    }>
    onRetry?: (index: number) => void
    onFilesChange: (files: File[]) => void
}

export function FileUploadField({
    name,
    accept,
    multiple,
    required,
    existingFiles = [],
    files,
    disabled = false,
    uploadStates = [],
    onRetry,
    onFilesChange,
}: FileUploadFieldProps) {
    const [inputKey, setInputKey] = useState(0)
    const [removeIconByKey, setRemoveIconByKey] = useState<
        Record<string, "light" | "dark">
    >({})

    const previews = useMemo(
        () =>
            files.map((file) => ({
                file,
                url: file.type.startsWith("image/")
                    ? URL.createObjectURL(file)
                    : null,
            })),
        [files]
    )

    useEffect(() => {
        return () => {
            previews.forEach((preview) => {
                if (preview.url) URL.revokeObjectURL(preview.url)
            })
        }
    }, [previews])

    function removeFile(indexToRemove: number) {
        onFilesChange(files.filter((_, index) => index !== indexToRemove))
        setInputKey((value) => value + 1)
    }

    function handleFilesChange(selectedFiles: File[]) {
        onFilesChange(
            multiple ? [...files, ...selectedFiles] : selectedFiles.slice(0, 1)
        )
        setInputKey((value) => value + 1)
    }

    function getFileKey(file: File) {
        return `${file.name}-${file.size}-${file.lastModified}`
    }

    function updateImageRemoveIcon(file: File, image: HTMLImageElement) {
        const canvas = document.createElement("canvas")
        const context = canvas.getContext("2d")

        if (!context) return

        canvas.width = 1
        canvas.height = 1
        context.drawImage(image, 0, 0, 1, 1)

        const [red, green, blue] = context.getImageData(0, 0, 1, 1).data
        const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue

        setRemoveIconByKey((current) => ({
            ...current,
            [getFileKey(file)]: luminance > 150 ? "dark" : "light",
        }))
    }

    return (
        <div>
            <label className={`flex min-h-32 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-black/20 bg-[var(--onboarding-surface,#FFFFFF)] px-3 py-6 text-center transition sm:min-h-0 sm:px-4 sm:py-8 ${disabled ? "cursor-wait opacity-70" : "cursor-pointer hover:border-[var(--onboarding-primary,#1E3A5F)]"}`}>
                <span className="text-base font-semibold text-[var(--onboarding-text,#0F172A)]">
                    Tap to choose {multiple ? "files" : "a file"}
                </span>
                <span className="mt-2 text-sm leading-6 text-[var(--onboarding-muted,#475569)]">
                    Uploads begin immediately in the background. You can keep
                    completing the rest of the step.
                </span>
                <input
                    key={`${name}-${inputKey}`}
                    type="file"
                    accept={getFileAcceptValue(accept)}
                    multiple={multiple}
                    disabled={disabled}
                    required={
                        required &&
                        existingFiles.length === 0 &&
                        files.length === 0
                    }
                    className="sr-only"
                    onChange={(event) =>
                        handleFilesChange(
                            Array.from(event.currentTarget.files ?? [])
                        )
                    }
                />
            </label>

            {files.length > 0 && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {previews.map(({ file, url }, index) => (
                        <div
                            key={getFileKey(file)}
                            className="relative overflow-hidden rounded-xl border border-black/10 bg-[var(--onboarding-surface,#FFFFFF)]"
                        >
                            {(() => {
                                const removeIconTone =
                                    removeIconByKey[getFileKey(file)] ??
                                    (url ? "light" : "dark")

                                return (
                                    <button
                                        type="button"
                                        disabled={disabled}
                                        onClick={() => removeFile(index)}
                                        aria-label={`Remove ${file.name}`}
                                        className={`absolute right-0 top-0 z-20 flex h-11 w-11 items-center justify-center text-3xl font-medium leading-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)] focus:outline-none ${
                                            removeIconTone === "light"
                                                ? "text-white"
                                                : "text-black"
                                        }`}
                                    >
                                        ×
                                    </button>
                                )
                            })()}

                            {url ? (
                                <img
                                    src={url}
                                    alt=""
                                    onLoad={(event) =>
                                        updateImageRemoveIcon(
                                            file,
                                            event.currentTarget
                                        )
                                    }
                                    className="h-32 w-full object-cover sm:h-36"
                                />
                            ) : (
                                <div className="flex h-24 items-center justify-center bg-[var(--onboarding-page,#F8F7F3)] px-4 text-center text-sm font-medium text-[var(--onboarding-muted,#475569)]">
                                    {file.type.startsWith("video/")
                                        ? "Video selected"
                                        : "File selected"}
                                </div>
                            )}

                            <div className="p-3">
                                <p className="truncate pr-6 text-sm font-medium text-[var(--onboarding-text,#0F172A)]">
                                    {file.name}
                                </p>
                                <p className="mt-1 text-xs text-[var(--onboarding-muted,#475569)]">
                                    {(file.size / 1024 / 1024).toFixed(1)} MB
                                </p>
                                {(() => {
                                    const upload = uploadStates[index]
                                    if (!upload) return null
                                    if (upload.status === "error") {
                                        return <div className="mt-2"><p className="text-xs text-red-700">Upload paused.</p>{onRetry ? <button type="button" disabled={disabled} onClick={() => onRetry(index)} className="mt-1 text-xs font-semibold text-[var(--onboarding-primary,#1E3A5F)] underline underline-offset-2 disabled:opacity-60">Retry upload</button> : null}</div>
                                    }
                                    const label = upload.status === "uploaded"
                                        ? "Ready"
                                        : upload.status === "preparing"
                                            ? "Preparing…"
                                            : `Uploading ${upload.progress}%`
                                    return <div className="mt-2"><p className="text-xs font-medium text-[var(--onboarding-muted,#475569)]">{label}</p>{upload.status !== "uploaded" ? <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-black/10"><div className="h-full rounded-full bg-[var(--onboarding-primary,#1E3A5F)] transition-[width]" style={{ width: `${upload.progress}%` }} /></div> : null}</div>
                                })()}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {existingFiles.length > 0 && (
                <div className="mt-4 rounded-xl bg-[var(--onboarding-page,#F8F7F3)] p-3 text-sm text-[var(--onboarding-muted,#475569)]">
                    {existingFiles.length} file
                    {existingFiles.length === 1 ? "" : "s"} already uploaded.
                    Choosing more files will add to them.
                </div>
            )}
        </div>
    )
}
