"use client"

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode, type SyntheticEvent } from "react"
import {
    registerWorkspaceAutosaveFlusher,
    runWorkspaceMutation,
    type WorkspaceMutationResult,
} from "@/lib/workspace-mutations"

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error"
type AutosaveResult = WorkspaceMutationResult<unknown> | void

function formSnapshot(formData: FormData) {
    return JSON.stringify([...formData.entries()].map(([key, value]) => [
        key,
        typeof value === "string" ? value : `${value.name}:${value.size}:${value.type}`,
    ]))
}

function failure(result: AutosaveResult) {
    return result && typeof result === "object" && result.ok === false ? result : null
}

function savesImmediately(target: EventTarget | null) {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return false
    return target instanceof HTMLSelectElement || ["checkbox", "radio", "date", "time", "number"].includes(target.type)
}

export function WorkspaceAutosaveForm({
    action,
    children,
    className,
    debounceMs = 800,
    statusClassName = "mt-3 text-xs text-neutral-500",
}: {
    action: (formData: FormData) => AutosaveResult | Promise<AutosaveResult>
    children: ReactNode
    className?: string
    debounceMs?: number
    statusClassName?: string
}) {
    const formRef = useRef<HTMLFormElement>(null)
    const timerRef = useRef<number | null>(null)
    const pendingRef = useRef<FormData | null>(null)
    const failedRef = useRef<FormData | null>(null)
    const savingPromiseRef = useRef<Promise<void> | null>(null)
    const lastSavedRef = useRef("")
    const mountedRef = useRef(true)
    const [saveState, setSaveState] = useState<SaveState>("idle")
    const [saveError, setSaveError] = useState<string | null>(null)

    const saveLatest = useCallback(async () => {
        const form = formRef.current
        if (!form || !form.checkValidity()) return
        if (timerRef.current) {
            window.clearTimeout(timerRef.current)
            timerRef.current = null
        }
        const next = new FormData(form)
        if (formSnapshot(next) !== lastSavedRef.current) pendingRef.current = next
        if (savingPromiseRef.current) return savingPromiseRef.current

        const drain = async () => {
            while (pendingRef.current) {
                const submitted = pendingRef.current
                pendingRef.current = null
                const submittedSnapshot = formSnapshot(submitted)
                if (submittedSnapshot === lastSavedRef.current) continue
                if (mountedRef.current) {
                    setSaveState("saving")
                    setSaveError(null)
                }
                try {
                    const result = await runWorkspaceMutation(() => Promise.resolve(action(submitted)))
                    const rejected = failure(result)
                    if (rejected) {
                        failedRef.current = submitted
                        if (mountedRef.current) {
                            setSaveState("error")
                            setSaveError(rejected.error)
                        }
                        break
                    }
                    failedRef.current = null
                    lastSavedRef.current = submittedSnapshot
                    const currentForm = formRef.current
                    if (currentForm) {
                        const current = new FormData(currentForm)
                        if (formSnapshot(current) !== lastSavedRef.current) pendingRef.current = current
                    }
                    if (mountedRef.current) setSaveState(pendingRef.current ? "saving" : "saved")
                } catch (error) {
                    failedRef.current = submitted
                    if (mountedRef.current) {
                        setSaveState("error")
                        setSaveError(error instanceof Error ? error.message : "These changes could not be saved.")
                    }
                    break
                }
            }
        }

        savingPromiseRef.current = drain().finally(() => {
            savingPromiseRef.current = null
        })
        return savingPromiseRef.current
    }, [action])

    useEffect(() => {
        mountedRef.current = true
        const form = formRef.current
        if (form) lastSavedRef.current = formSnapshot(new FormData(form))
        const unregister = registerWorkspaceAutosaveFlusher(saveLatest)
        return () => {
            mountedRef.current = false
            unregister()
            if (timerRef.current) window.clearTimeout(timerRef.current)
        }
    }, [saveLatest])

    function schedule(event: SyntheticEvent<HTMLFormElement>) {
        failedRef.current = null
        setSaveError(null)
        setSaveState("dirty")
        if (timerRef.current) window.clearTimeout(timerRef.current)
        if (savesImmediately(event.target)) {
            void saveLatest()
            return
        }
        timerRef.current = window.setTimeout(() => void saveLatest(), debounceMs)
    }

    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (!event.currentTarget.reportValidity()) return
        void saveLatest()
    }

    function retry() {
        if (failedRef.current) pendingRef.current = failedRef.current
        void saveLatest()
    }

    const status = saveState === "saving"
        ? "Saving changes…"
        : saveState === "saved"
            ? "Saved"
            : saveState === "error"
                ? saveError ?? "These changes could not be saved."
                : saveState === "dirty"
                    ? "Changes will save automatically"
                    : "Changes save automatically"

    return <form
        ref={formRef}
        onSubmit={submit}
        onChange={schedule}
        onInput={schedule}
        onBlurCapture={() => { if (saveState === "dirty") void saveLatest() }}
        className={className}
        data-workspace-autosave="true"
    >
        {children}
        <div className={`flex items-center gap-2 ${statusClassName}`}>
            <p aria-live="polite" className={saveState === "error" ? "text-red-300" : undefined}>{status}</p>
            {saveState === "error" ? <button type="button" onClick={retry} className="text-red-200 underline decoration-red-500/50 underline-offset-2 hover:text-white">Retry</button> : null}
        </div>
    </form>
}
