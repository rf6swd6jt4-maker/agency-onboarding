"use client"

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useRef, useState } from "react"
import { AuthFieldFeedback } from "@/components/auth/AuthFieldFeedback"
import { authPrimaryButton, authSecondaryButton } from "@/components/auth/AuthFlowShell"
import { OtpField } from "@/components/auth/OtpField"

type MfaState = "checking" | "verify" | "start-setup" | "setup"
export type MfaGuideStage = "checking" | "introduction" | "setup" | "verification"
type SetupMethod = "qr" | "manual"

export function MfaGuide({ onVerified, onStageChange, setupLabel = "Betelgeze", forceSetup = false }: { onVerified: () => void; onStageChange?: (stage: MfaGuideStage) => void; setupLabel?: string; forceSetup?: boolean }) {
    const [state, setState] = useState<MfaState>("checking")
    const [setupMethod, setSetupMethod] = useState<SetupMethod>("qr")
    const [code, setCode] = useState("")
    const [factorId, setFactorId] = useState("")
    const [qr, setQr] = useState("")
    const [secret, setSecret] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const submittedCode = useRef("")

    useEffect(() => {
        const stage: MfaGuideStage = state === "start-setup" ? "introduction" : state === "setup" ? "setup" : state === "verify" ? "verification" : "checking"
        onStageChange?.(stage)
    }, [onStageChange, state])

    useEffect(() => {
        void fetch("/api/auth/mfa", { cache: "no-store" })
            .then(async (response) => {
                const body = await response.json() as { assured?: boolean; verified?: boolean; reenrollmentRequired?: boolean; verifiedFactorCount?: number; pendingFactorId?: string | null; error?: string }
                if (!response.ok) throw new Error(body.error ?? "Your session has expired. Sign in again.")
                if (body.assured && !forceSetup) { onVerified(); return }
                if (body.pendingFactorId) setFactorId(body.pendingFactorId)
                const needsNewFactor = forceSetup || body.reenrollmentRequired
                setState(needsNewFactor && !body.pendingFactorId ? "start-setup" : body.verified || body.pendingFactorId ? "verify" : "start-setup")
            })
            .catch(() => setError("We could not check your authenticator. Refresh the page and try again."))
    }, [forceSetup, onVerified])

    const verify = useCallback(async (submitted = code) => {
        if (submitting || submitted.length !== 6 || submittedCode.current === submitted) return
        submittedCode.current = submitted
        setSubmitting(true); setError(null); setNotice("Checking that code…")
        try {
            const response = await fetch("/api/auth/mfa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: submitted, factorId }) })
            const body = await response.json() as { error?: string; code?: string }
            if (!response.ok) throw new Error(body.error ?? "That code did not match.")
            setNotice("Authenticator confirmed.")
            onVerified()
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "That code did not match. Check your authenticator and try again.")
            setNotice(null); setCode(""); submittedCode.current = ""
        } finally { setSubmitting(false) }
    }, [code, factorId, onVerified, submitting])

    async function requestSetup() {
        setSubmitting(true); setError(null); setNotice("Preparing a secure setup key…")
        try {
            const response = await fetch("/api/auth/mfa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "setup", friendlyName: setupLabel }) })
            const body = await response.json() as { factorId?: string; qr?: string; secret?: string; pending?: boolean; error?: string }
            if (!response.ok || !body.factorId) throw new Error(body.error ?? "We could not start authenticator setup.")
            setFactorId(body.factorId)
            if (body.pending) { setState("verify"); setNotice("Finish verifying the authenticator you already started."); return }
            if (!body.qr || !body.secret) throw new Error("The authenticator setup was incomplete. Please start again.")
            setQr(body.qr); setSecret(body.secret); setSetupMethod("qr"); setState("setup"); setNotice(null)
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "We could not start authenticator setup."); setNotice(null)
        } finally { setSubmitting(false) }
    }

    async function resetPending() {
        setSubmitting(true); setError(null)
        const response = await fetch("/api/auth/mfa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reset-setup" }) })
        if (!response.ok) {
            const body = await response.json().catch(() => ({}))
            setError(body.error ?? "We could not clear the unfinished setup.")
            setSubmitting(false); return
        }
        setCode(""); setFactorId(""); setQr(""); setSecret(""); setSetupMethod("qr"); setState("start-setup"); submittedCode.current = ""; setSubmitting(false)
    }

    if (state === "checking") return <AuthFieldFeedback tone={error ? "red" : "yellow"} message={error ?? "Checking account security…"} />
    if (state === "start-setup") return (
        <div>
            <AuthFieldFeedback tone="yellow" message="Authenticator required before account access." />
            <p className="mt-4 text-sm leading-6 text-neutral-300">Use 1Password, Google Authenticator, Microsoft Authenticator, Authy, or another TOTP-compatible app.</p>
            <button type="button" onClick={requestSetup} disabled={submitting} className={`${authPrimaryButton} mt-6`}>{submitting ? "Preparing…" : "Set up authenticator"}</button>
            {error ? <AuthFieldFeedback tone="red" message={error} /> : notice ? <AuthFieldFeedback tone="yellow" message={notice} /> : null}
        </div>
    )

    if (state === "setup") return (
        <div>
            <div role="tablist" aria-label="Authenticator setup method" className="flex border-b border-neutral-800">
                <button type="button" role="tab" aria-selected={setupMethod === "qr"} onClick={() => { setSetupMethod("qr"); setNotice(null) }} className={`min-h-11 flex-1 border-b-2 px-3 py-2.5 text-sm font-medium transition ${setupMethod === "qr" ? "border-white text-white" : "border-transparent text-neutral-500 hover:text-neutral-300"}`}>QR code</button>
                <button type="button" role="tab" aria-selected={setupMethod === "manual"} onClick={() => { setSetupMethod("manual"); setNotice(null) }} className={`min-h-11 flex-1 border-b-2 px-3 py-2.5 text-sm font-medium transition ${setupMethod === "manual" ? "border-white text-white" : "border-transparent text-neutral-500 hover:text-neutral-300"}`}>Manual key</button>
            </div>
            {setupMethod === "qr" ? (
                <div className="pt-6 text-center">
                    <div className="mx-auto w-fit rounded-xl border border-neutral-700 bg-white p-3"><img src={qr} alt="QR code for authenticator setup" className="h-48 w-48 sm:h-52 sm:w-52" /></div>
                    <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-neutral-300">Open your authenticator app and scan this QR code. Keep this page open until the account appears in your app.</p>
                </div>
            ) : (
                <div className="pt-6">
                    <p className="text-sm leading-6 text-neutral-300">Choose manual entry in your authenticator app, then enter this setup key.</p>
                    <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950 p-4">
                        <p className="text-xs text-neutral-500">Manual setup key</p>
                        <code className="mt-3 block break-all text-sm leading-6 text-neutral-100">{secret}</code>
                        <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(secret); setNotice("Manual key copied.") } catch { setNotice("Copy was unavailable. Select the key and copy it manually.") } }} className="mt-3 min-h-10 text-sm text-neutral-200 underline decoration-neutral-600 underline-offset-4 hover:decoration-neutral-300">Copy setup key</button>
                    </div>
                </div>
            )}
            {notice ? <AuthFieldFeedback tone={notice === "Manual key copied." ? "green" : "yellow"} message={notice} /> : null}
            <button type="button" onClick={() => { setState("verify"); setNotice(null); setError(null) }} className={`${authPrimaryButton} mt-6`}>Continue to verification</button>
        </div>
    )

    return (
        <div>
            <p className="text-sm leading-6 text-neutral-300">Enter the current six-digit code from your authenticator app. This confirms that setup worked before Betelgeze secures your account.</p>
            <form onSubmit={(event) => { event.preventDefault(); void verify() }} className="mt-6">
                <OtpField value={code} onChange={setCode} onComplete={(value) => void verify(value)} label="Authenticator code" disabled={submitting} invalid={Boolean(error)} />
                <button type="submit" disabled={submitting || code.length !== 6} className={`${authPrimaryButton} mt-6`}>{submitting ? "Verifying…" : "Verify and continue"}</button>
            </form>
            {notice ? <AuthFieldFeedback tone={notice.includes("confirmed") ? "green" : "yellow"} message={notice} /> : null}
            {error ? <AuthFieldFeedback tone="red" message={error} /> : null}
            {qr && secret ? <button type="button" onClick={() => { setState("setup"); setError(null); setNotice(null); setCode(""); submittedCode.current = "" }} disabled={submitting} className={`${authSecondaryButton} mt-3`}>Back to setup instructions</button> : factorId ? <button type="button" onClick={resetPending} disabled={submitting} className={`${authSecondaryButton} mt-3`}>Restart authenticator setup</button> : null}
            {factorId && !qr ? <p className="mt-3 text-xs leading-5 text-neutral-500">Restart only if you no longer have the setup details. It clears this unfinished authenticator and creates a new one.</p> : null}
        </div>
    )
}
