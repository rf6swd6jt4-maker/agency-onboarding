"use client"

import { useState, useTransition } from "react"
import { DetailDangerAction, DetailDangerButton, DetailDangerZone } from "@/components/detail"

export function CopyOnboardingLink({ path }: { path: string }) {
    const [copied, setCopied] = useState(false)

    async function copyLink() {
        await navigator.clipboard.writeText(new URL(path, window.location.origin).toString())
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1800)
    }

    return (
        <button type="button" onClick={copyLink} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-neutral-700 px-3 text-sm text-neutral-200 hover:border-neutral-500 hover:text-white">
            {copied ? "Copied" : "Copy link"}
        </button>
    )
}

export function OnboardingLinkControls({
    initialPath,
    revoked,
    revokeAction,
    rotateAction,
}: {
    initialPath: string | null
    revoked: boolean
    revokeAction: () => Promise<{ ok: true; revoked: true }>
    rotateAction: () => Promise<{ ok: true; path: string }>
}) {
    const [path, setPath] = useState(initialPath)
    const [isRevoked, setIsRevoked] = useState(revoked)
    const [pending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)

    function rotate() {
        setError(null)
        startTransition(async () => {
            try {
                const outcome = await rotateAction()
                setPath(outcome.path)
                setIsRevoked(false)
            } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Could not rotate the link")
            }
        })
    }

    function revoke() {
        if (!window.confirm("Revoke this onboarding link? Progress and submitted information will be preserved.")) return
        setError(null)
        startTransition(async () => {
            try {
                await revokeAction()
                setIsRevoked(true)
            } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Could not revoke the link")
            }
        })
    }

    return (
        <div>
            <div className="grid grid-cols-2 gap-2 sm:flex">
                {path && !isRevoked ? <CopyOnboardingLink path={path} /> : null}
                {path && !isRevoked ? <a href={path} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-medium text-black">Preview session</a> : null}
                <button type="button" disabled={pending} onClick={rotate} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-neutral-700 px-3 text-sm text-neutral-200 disabled:opacity-50">
                    {pending ? "Updating…" : path ? "Rotate link" : "Create new link"}
                </button>
                <button type="button" disabled={pending || isRevoked || !path} onClick={revoke} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-red-500/40 px-3 text-sm text-red-100 disabled:opacity-40">Revoke</button>
            </div>
            {isRevoked ? <p className="mt-2 text-sm text-amber-200">The current link is revoked. Rotate it to restore access without resetting progress.</p> : null}
            {error ? <p role="alert" className="mt-2 text-sm text-red-200">{error}</p> : null}
        </div>
    )
}

export function OnboardingDangerZone({
    hasSession,
    archiveAction,
    restartAction,
}: {
    hasSession: boolean
    archiveAction: () => Promise<void>
    restartAction: () => Promise<void>
}) {
    const [pending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)

    function run(action: () => Promise<void>, message: string) {
        if (!window.confirm(message)) return
        setError(null)
        startTransition(async () => {
            try {
                await action()
            } catch (actionError) {
                setError(actionError instanceof Error ? actionError.message : "Could not update onboarding")
            }
        })
    }

    return (
        <DetailDangerZone>
            <DetailDangerAction
                title="Archive onboarding"
                description="Disable the current client link and cancel unfinished onboarding work. Submitted information and completed work remain available."
                control={<DetailDangerButton type="button" disabled={pending || !hasSession} onClick={() => run(archiveAction, "Archive this onboarding session? The current client link will stop working.")}>{pending ? "Updating…" : hasSession ? "Archive onboarding" : "No session to archive"}</DetailDangerButton>}
            />
            <DetailDangerAction
                title="Restart onboarding"
                description="Create a fresh client link and reset every step. Previous submissions and uploads remain stored as historical assets."
                control={<DetailDangerButton type="button" disabled={pending} onClick={() => run(restartAction, "Restart onboarding with a new client link? The current link will stop working.")}>{pending ? "Updating…" : "Restart onboarding"}</DetailDangerButton>}
            />
            <DetailDangerAction
                title="Delete onboarding permanently"
                description="Permanent deletion will be enabled after the shared archive lifecycle and asset-retention safeguards are implemented."
                control={<DetailDangerButton type="button" tone="delete" disabled>Delete permanently</DetailDangerButton>}
            />
            {error ? <p role="alert" className="mt-4 text-sm text-red-200">{error}</p> : null}
        </DetailDangerZone>
    )
}
