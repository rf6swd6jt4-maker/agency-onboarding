"use client"

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import { runWorkspaceBackgroundMutation } from "@/lib/workspace-background"

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error"

function formSnapshot(formData: FormData) {
    return JSON.stringify([...formData.entries()].map(([key, value]) => [
        key,
        typeof value === "string" ? value : `${value.name}:${value.size}:${value.type}`,
    ]))
}

export function WorkspaceAutosaveForm({
    action,
    children,
    className,
    debounceMs = 900,
    statusClassName = "mt-3 text-xs text-neutral-500",
}: {
    action: (formData: FormData) => void | Promise<void>
    children: ReactNode
    className?: string
    debounceMs?: number
    statusClassName?: string
}) {
    const formRef = useRef<HTMLFormElement>(null)
    const timerRef = useRef<number | null>(null)
    const savingRef = useRef(false)
    const resaveRef = useRef(false)
    const lastSavedRef = useRef("")
    const mountedRef = useRef(true)
    const [saveState, setSaveState] = useState<SaveState>("idle")

    useEffect(() => {
        mountedRef.current = true
        const form = formRef.current
        if (form) lastSavedRef.current = formSnapshot(new FormData(form))
        return () => {
            mountedRef.current = false
            if (timerRef.current) window.clearTimeout(timerRef.current)
        }
    }, [])

    async function save() {
        const form = formRef.current
        if (!form || !form.reportValidity()) return
        const formData = new FormData(form)
        const snapshot = formSnapshot(formData)
        if (snapshot === lastSavedRef.current) {
            if (mountedRef.current) setSaveState("saved")
            return
        }
        if (savingRef.current) {
            resaveRef.current = true
            return
        }
        savingRef.current = true
        if (mountedRef.current) setSaveState("saving")
        try {
            await runWorkspaceBackgroundMutation(() => Promise.resolve(action(formData)))
            lastSavedRef.current = snapshot
            if (mountedRef.current) setSaveState("saved")
        } catch {
            if (mountedRef.current) setSaveState("error")
        } finally {
            savingRef.current = false
            if (resaveRef.current) {
                resaveRef.current = false
                void save()
            }
        }
    }

    function schedule() {
        if (timerRef.current) window.clearTimeout(timerRef.current)
        setSaveState("dirty")
        timerRef.current = window.setTimeout(() => void save(), debounceMs)
    }

    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (timerRef.current) window.clearTimeout(timerRef.current)
        void save()
    }

    const status = saveState === "saving"
        ? "Saving changes…"
        : saveState === "saved"
            ? "Saved automatically"
            : saveState === "error"
                ? "Could not save automatically. Change a field to retry."
                : "Changes save automatically"

    return <form
        ref={formRef}
        onSubmit={submit}
        onChange={schedule}
        onInput={schedule}
        className={className}
        data-workspace-autosave="true"
    >
        {children}
        <p aria-live="polite" className={`${statusClassName} ${saveState === "error" ? "text-red-300" : ""}`}>{status}</p>
    </form>
}
