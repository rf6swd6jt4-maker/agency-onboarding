export function onboardingStepNativeKey(sessionId: string, stepKey: string) {
    return `${sessionId}:${stepKey}`
}

export function onboardingSnapshotStepNativeKey(sessionId: string, sessionStepId: string) {
    return `${sessionId}:step:${sessionStepId}`
}

export function onboardingSubmissionNativeKey(sessionId: string, stepKey: string) {
    return `${sessionId}:${stepKey}:submission`
}

export function onboardingSnapshotSubmissionNativeKey(sessionId: string, sessionStepId: string) {
    return `${sessionId}:step:${sessionStepId}:submission`
}

export function onboardingUploadNativeKey(sessionId: string, stepKey: string, storagePath: string) {
    return `${sessionId}:${stepKey}:upload:${storagePath}`
}

export function onboardingSnapshotUploadNativeKey(sessionId: string, sessionStepId: string, storagePath: string) {
    return `${sessionId}:step:${sessionStepId}:upload:${storagePath}`
}

export function classifyUploadAsset(upload: { type: string; name: string }): "file" | "media" | "document" {
    const type = upload.type || "application/octet-stream"
    const name = upload.name.toLowerCase()
    if (type.startsWith("image/") || type.startsWith("video/") || type.startsWith("audio/")) return "media"
    if (
        type.includes("pdf") ||
        type.includes("document") ||
        type.includes("spreadsheet") ||
        type.includes("presentation") ||
        [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"].some((suffix) => name.endsWith(suffix))
    ) return "document"
    return "file"
}
