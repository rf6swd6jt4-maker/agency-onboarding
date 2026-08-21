"use client"

import { FormEvent, useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { AuthFieldFeedback } from "@/components/auth/AuthFieldFeedback"
import { AuthBackToLogin, AuthFlowShell, authInput, authPrimaryButton, authSecondaryButton } from "@/components/auth/AuthFlowShell"
import { OtpField } from "@/components/auth/OtpField"
import { PasswordField } from "@/components/auth/PasswordField"
import { passwordRequirements } from "@/lib/auth/password"

type RecoveryStep = "request" | "code" | "new-password" | "complete"
type Result = { next?: string; error?: string }

async function postRecovery(action: string, values: Record<string, unknown> = {}) {
    const response = await fetch("/api/auth/recovery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...values }) })
    const result = await response.json().catch(() => ({})) as Result
    if (!response.ok) throw new Error(result.error ?? "Password recovery was interrupted.")
    return result
}

function RequestStep({ initialEmail }: { initialEmail: string }) {
    const [email, setEmail] = useState(initialEmail)
    const [emailTouched, setEmailTouched] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const emailValid = /^\S+@\S+\.\S+$/.test(email.trim())
    const emailInvalid = emailTouched && email.length > 3 && !emailValid
    return <AuthFlowShell showProgress={false} eyebrow="Password recovery" title="Recover your account" description="We’ll email a six-digit code. For privacy, the next screen looks the same whether or not an account exists." footer={<AuthBackToLogin />}>
        <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4"><AuthFieldFeedback tone="grey" message="The code expires quickly and only the newest code works." /><p className="mt-3 text-xs leading-5 text-neutral-500">Changing your password does not remove two-factor authentication. You will still use your authenticator when you next sign in.</p></div>
        <form className="mt-6" onSubmit={async (event) => { event.preventDefault(); setLoading(true); setError(null); try { const result = await postRecovery("request", { email }); window.location.assign(result.next ?? "/forgot-password/code") } catch (reason) { setError(reason instanceof Error ? reason.message : "A recovery email could not be requested.") } finally { setLoading(false) } }}>
            <label htmlFor="recovery-email" className="text-sm font-medium text-neutral-200">Account email</label>
            <input id="recovery-email" value={email} onChange={(event) => setEmail(event.target.value)} onBlur={() => setEmailTouched(true)} type="email" inputMode="email" autoComplete="email" required aria-invalid={emailInvalid} aria-describedby="recovery-email-status" className={authInput} />
            <AuthFieldFeedback id="recovery-email-status" tone={emailValid ? "green" : emailInvalid ? "red" : "grey"} message={emailValid ? "Email format looks good." : emailInvalid ? "Enter a complete email address." : "Use the email address on your Betelgeze account."} />
            {error ? <AuthFieldFeedback tone="red" message={error} /> : null}
            <button disabled={loading || !emailValid} className={`${authPrimaryButton} mt-6`}>{loading ? "Requesting…" : "Send recovery code"}</button>
        </form>
    </AuthFlowShell>
}

function CodeStep({ maskedEmail }: { maskedEmail: string }) {
    const [code, setCode] = useState("")
    const [loading, setLoading] = useState(false)
    const [status, setStatus] = useState<{ tone: "yellow" | "green" | "red"; message: string }>({ tone: "yellow", message: `If an account exists, a code was sent to ${maskedEmail}.` })
    const [seconds, setSeconds] = useState(60)
    useEffect(() => { if (!seconds) return; const timer = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000); return () => clearInterval(timer) }, [seconds])
    const verify = useCallback(async (submittedCode = code) => {
        if (loading || submittedCode.length !== 6) return
        setLoading(true); setStatus({ tone: "yellow", message: "Checking the newest recovery code…" })
        try { const result = await postRecovery("verify", { code: submittedCode }); setStatus({ tone: "green", message: "Code verified." }); window.location.assign(result.next ?? "/forgot-password/new-password") }
        catch (reason) { setCode(""); setStatus({ tone: "red", message: reason instanceof Error ? reason.message : "That code did not match." }) }
        finally { setLoading(false) }
    }, [code, loading])
    return <AuthFlowShell showProgress={false} eyebrow="Password recovery" title="Enter your recovery code" description="Use the six digits in the middle of the newest Betelgeze recovery email." footer={<><Link href="/forgot-password" className="underline underline-offset-4">Use a different email</Link><span className="mx-2">·</span><AuthBackToLogin /></>}>
        <form onSubmit={(event) => { event.preventDefault(); void verify() }}><OtpField value={code} onChange={setCode} onComplete={(value) => void verify(value)} disabled={loading} invalid={status.tone === "red"} /><AuthFieldFeedback tone={status.tone} message={status.message} /><button disabled={loading || code.length !== 6} className={`${authPrimaryButton} mt-6`}>{loading ? "Verifying…" : "Continue"}</button></form>
        <button type="button" disabled={loading || seconds > 0} onClick={async () => { setLoading(true); try { await postRecovery("resend"); setSeconds(60); setStatus({ tone: "green", message: "A fresh code has been requested." }) } catch (reason) { setStatus({ tone: "red", message: reason instanceof Error ? reason.message : "A fresh code could not be requested." }) } finally { setLoading(false) } }} className={`${authSecondaryButton} mt-3`}>{seconds ? `Request a fresh code in ${seconds}s` : "Request a fresh code"}</button>
    </AuthFlowShell>
}

function NewPasswordStep() {
    const [password, setPassword] = useState("")
    const [confirm, setConfirm] = useState("")
    const [touched, setTouched] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const valid = passwordRequirements(password).every((requirement) => requirement.met) && password === confirm
    return <AuthFlowShell showProgress={false} eyebrow="Password recovery" title="Choose a new password" description="Use a password you have not used elsewhere. Your authenticator remains enabled." footer={<AuthBackToLogin />}>
        <form onSubmit={async (event: FormEvent) => { event.preventDefault(); setTouched(true); if (!valid) return; setLoading(true); setError(null); try { const result = await postRecovery("update", { password }); const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("betelgeze-account-security") : null; channel?.postMessage({ type: "password-reset-complete" }); channel?.close(); localStorage.setItem("betelgeze-password-reset-complete", String(Date.now())); window.location.assign(result.next ?? "/forgot-password/complete") } catch (reason) { setError(reason instanceof Error ? reason.message : "The password could not be changed.") } finally { setLoading(false) } }}>
            <PasswordField value={password} onChange={setPassword} disabled={loading} />
            <div className="mt-5"><PasswordField value={confirm} onChange={(value) => { setConfirm(value); setTouched(true) }} name="confirm-password" label="Confirm new password" showRequirements={false} disabled={loading} invalid={touched && confirm !== password} /></div>
            {touched ? <AuthFieldFeedback tone={confirm && confirm === password ? "green" : "red"} message={confirm && confirm === password ? "Passwords match." : "Enter the same password again."} /> : <AuthFieldFeedback tone="grey" message="Repeat the new password before saving." />}
            {error ? <AuthFieldFeedback tone="red" message={error} /> : null}
            <button disabled={loading || !valid} className={`${authPrimaryButton} mt-6`}>{loading ? "Changing password…" : "Change password"}</button>
        </form>
    </AuthFlowShell>
}

function CompleteStep() {
    return <AuthFlowShell showProgress={false} eyebrow="Password recovery" title="Password reset" description="Your password has been changed and this recovery session is closed. Other open login tabs have been told to ask for your new password." footer={<>You can safely close this tab.</>}><div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4"><AuthFieldFeedback tone="green" message="Your new password is ready to use." /><AuthFieldFeedback tone="yellow" message="Two-factor authentication is still required at login." /></div><Link href="/login?passwordReset=1" className={`${authPrimaryButton} mt-6`}>Return to login</Link></AuthFlowShell>
}

export function PasswordRecoveryFlow({ step, initialEmail = "", maskedEmail = "your email" }: { step: RecoveryStep; initialEmail?: string; maskedEmail?: string }) {
    if (step === "request") return <RequestStep initialEmail={initialEmail} />
    if (step === "code") return <CodeStep maskedEmail={maskedEmail} />
    if (step === "new-password") return <NewPasswordStep />
    return <CompleteStep />
}
