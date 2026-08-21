"use client"

/* eslint-disable @next/next/no-img-element */

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { AuthFieldFeedback } from "@/components/auth/AuthFieldFeedback"
import { AuthFlowShell, authInput, authPrimaryButton, authSecondaryButton } from "@/components/auth/AuthFlowShell"
import { MfaGuide } from "@/components/auth/MfaGuide"
import { OtpField } from "@/components/auth/OtpField"
import { PasswordField } from "@/components/auth/PasswordField"
import type { AuthStep, FieldValidationState, OnboardingContext } from "@/lib/auth/account-flow-types"
import { passwordRequirements } from "@/lib/auth/password"
import { usernameFromEmail, usernameValidationMessage } from "@/lib/auth/username"

type ApiResult = { next?: string; error?: string; code?: string; alternatives?: string[] }

async function postOnboarding(action: string, values: Record<string, unknown> = {}) {
    const response = await fetch("/api/account/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...values }),
    })
    const result = await response.json().catch(() => ({})) as ApiResult
    if (!response.ok) throw Object.assign(new Error(result.error ?? "This step could not be completed."), { result })
    return result
}

function StepFrame({ context, step, title, description, children }: { context: OnboardingContext; step: AuthStep; title: string; description: string; children: React.ReactNode }) {
    return <AuthFlowShell step={step} eyebrow={`${context.workspaceName} invitation`} title={title} description={description} footer={<>Invited as <span className="font-medium text-neutral-200">{context.role === "admin" ? "Administrator" : "Staff"}</span> · {context.email}</>}>{children}</AuthFlowShell>
}

function ReviewStep({ context }: { context: OnboardingContext }) {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    async function continueFlow() {
        setLoading(true); setError(null)
        try { const result = await postOnboarding("review"); if (result.next) window.location.assign(result.next) }
        catch (reason) { setError(reason instanceof Error ? reason.message : "This invitation could not be opened.") }
        finally { setLoading(false) }
    }
    return <AuthFlowShell step="review" showProgress={false} eyebrow="Workspace invitation" title={`Join ${context.workspaceName}`} description={`${context.existingAccount ? "Your Betelgeze account is ready to use for this invitation." : "We’ll guide you through creating and securing your account."}`} footer={<>Invitation for <span className="font-medium text-neutral-200">{context.email}</span></>}>
        <div className="rounded-xl border border-neutral-800 bg-neutral-950/80 p-4">
            <p className="text-sm font-medium text-white">{context.workspaceName}</p>
            <div className="mt-3 space-y-2"><AuthFieldFeedback tone="green" message={`Invitation verified for ${context.email}`} /><AuthFieldFeedback tone="grey" message={`Workspace role: ${context.role === "admin" ? "Administrator" : "Staff"}`} />{context.existingAccount ? <AuthFieldFeedback tone="green" message="Existing Betelgeze account found" /> : <AuthFieldFeedback tone="yellow" message="A new account will be created" />}</div>
        </div>
        <button type="button" onClick={continueFlow} disabled={loading} className={`${authPrimaryButton} mt-6`}>{loading ? "Preparing…" : context.existingAccount ? "Continue securely" : "Create my account"}</button>
        {error ? <AuthFieldFeedback tone="red" message={error} /> : null}
    </AuthFlowShell>
}

function EmailStep({ context }: { context: OnboardingContext }) {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    return <StepFrame context={context} step="email" title="Confirm your email" description="Your account must use the address that received this workspace invitation.">
        <label htmlFor="signup-email" className="text-sm font-medium text-neutral-200">Email address</label>
        <input id="signup-email" value={context.email} readOnly aria-readonly="true" autoComplete="email" className={authInput} />
        <AuthFieldFeedback tone="green" message="Matches the verified invitation." />
        <button type="button" disabled={loading} onClick={async () => { setLoading(true); setError(null); try { const result = await postOnboarding("email"); if (result.next) window.location.assign(result.next) } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save this step.") } finally { setLoading(false) } }} className={`${authPrimaryButton} mt-6`}>{loading ? "Saving…" : "Continue"}</button>
        {error ? <AuthFieldFeedback tone="red" message={error} /> : null}
    </StepFrame>
}

function UsernameStep({ context }: { context: OnboardingContext }) {
    const [username, setUsername] = useState(context.usernameCandidate ?? usernameFromEmail(context.email))
    const [validation, setValidation] = useState<FieldValidationState>({ state: "idle", tone: "grey", message: "Used in your profile URL and visible to teammates." })
    const [alternatives, setAlternatives] = useState<string[]>([])
    const [loading, setLoading] = useState(false)
    const [touched, setTouched] = useState(false)
    const syntaxError = useMemo(() => usernameValidationMessage(username), [username])

    useEffect(() => {
        if (syntaxError) return
        const controller = new AbortController()
        const timeout = window.setTimeout(async () => {
            setValidation({ state: "checking", tone: "yellow", message: "Checking availability…" })
            try {
                const response = await fetch(`/api/account/username?value=${encodeURIComponent(username)}`, { signal: controller.signal, cache: "no-store" })
                const body = await response.json() as { available?: boolean; message?: string; alternatives?: string[] }
                setAlternatives(body.alternatives ?? [])
                setValidation({ state: body.available ? "valid" : "invalid", tone: body.available ? "green" : "red", message: body.message ?? (body.available ? "Username available." : "Username unavailable.") })
            } catch (reason) {
                if ((reason as Error).name !== "AbortError") setValidation({ state: "idle", tone: "grey", message: "Availability will be checked when you continue." })
            }
        }, 350)
        return () => { controller.abort(); window.clearTimeout(timeout) }
    }, [syntaxError, username])
    const displayedValidation = syntaxError ? { state: touched ? "invalid" as const : "idle" as const, tone: touched ? "red" as const : "grey" as const, message: syntaxError } : validation

    async function submit(event: FormEvent) {
        event.preventDefault(); if (syntaxError || validation.state !== "valid") return
        setLoading(true)
        try { const result = await postOnboarding("username", { username }); if (result.next) window.location.assign(result.next) }
        catch (reason) {
            const apiError = reason as Error & { result?: ApiResult }
            setAlternatives(apiError.result?.alternatives ?? [])
            setValidation({ state: "invalid", tone: "red", message: apiError.message })
        } finally { setLoading(false) }
    }
    return <StepFrame context={context} step="username" title="Choose your username" description="We generated a suggestion from your email. You can keep it or make it your own.">
        <form onSubmit={submit}>
            <label htmlFor="signup-username" className="text-sm font-medium text-neutral-200">Username</label>
            <input id="signup-username" name="username" value={username} onChange={(event) => { setUsername(event.target.value); if (event.target.value.length >= 3) setTouched(true) }} onBlur={() => setTouched(true)} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} minLength={3} className={authInput} aria-describedby="username-status" aria-invalid={displayedValidation.state === "invalid"} />
            <AuthFieldFeedback id="username-status" tone={displayedValidation.tone} message={displayedValidation.message} />
            {!syntaxError && alternatives.length ? <div className="mt-3 flex flex-wrap gap-2">{alternatives.map((alternative) => <button key={alternative} type="button" onClick={() => setUsername(alternative)} className="rounded-md border border-neutral-700 px-2.5 py-1.5 text-xs text-neutral-300 hover:border-neutral-500">@{alternative}</button>)}</div> : null}
            <button disabled={loading || displayedValidation.state !== "valid"} className={`${authPrimaryButton} mt-6`}>{loading ? "Reserving…" : "Continue"}</button>
        </form>
    </StepFrame>
}

function PasswordStep({ context }: { context: OnboardingContext }) {
    const [password, setPassword] = useState("")
    const [confirm, setConfirm] = useState("")
    const [confirmTouched, setConfirmTouched] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const valid = passwordRequirements(password).every((requirement) => requirement.met) && confirm === password
    async function submit(event: FormEvent) {
        event.preventDefault(); setConfirmTouched(true); if (!valid) return
        setLoading(true); setError(null)
        try { const result = await postOnboarding("signup", { password }); if (result.next) window.location.assign(result.next) }
        catch (reason) {
            const apiError = reason as Error & { result?: ApiResult }
            if (apiError.result?.code === "username_unavailable") { window.location.assign("/sign-up/username"); return }
            setError(apiError.message)
        } finally { setLoading(false) }
    }
    return <StepFrame context={context} step="password" title="Create a password" description="Use a unique password and let your password manager remember it.">
        <form onSubmit={submit}>
            <PasswordField value={password} onChange={setPassword} disabled={loading} />
            <div className="mt-5"><PasswordField value={confirm} onChange={(value) => { setConfirm(value); setConfirmTouched(true) }} name="confirm-password" label="Confirm password" showRequirements={false} disabled={loading} invalid={confirmTouched && confirm !== password} /></div>
            {confirmTouched ? <AuthFieldFeedback tone={confirm && confirm === password ? "green" : "red"} message={confirm && confirm === password ? "Passwords match." : "Enter the same password again."} /> : <AuthFieldFeedback tone="grey" message="Repeat your password to catch typing mistakes." />}
            {error ? <AuthFieldFeedback tone="red" message={error} /> : null}
            <button disabled={loading || !valid} className={`${authPrimaryButton} mt-6`}>{loading ? "Creating account…" : "Create account"}</button>
        </form>
    </StepFrame>
}

function VerifyEmailStep({ context }: { context: OnboardingContext }) {
    const [code, setCode] = useState("")
    const [loading, setLoading] = useState(false)
    const [message, setMessage] = useState<{ tone: "yellow" | "green" | "red"; text: string }>({ tone: "yellow", text: "A six-digit code is on its way." })
    const [seconds, setSeconds] = useState(60)
    useEffect(() => { if (!seconds) return; const timer = window.setInterval(() => setSeconds((current) => Math.max(0, current - 1)), 1000); return () => window.clearInterval(timer) }, [seconds])
    const submit = useCallback(async (submittedCode = code) => {
        if (loading || submittedCode.length !== 6) return
        setLoading(true); setMessage({ tone: "yellow", text: "Checking the newest code…" })
        try { const result = await postOnboarding("verify-email", { code: submittedCode }); setMessage({ tone: "green", text: "Email verified." }); if (result.next) window.location.assign(result.next) }
        catch (reason) { setCode(""); setMessage({ tone: "red", text: reason instanceof Error ? reason.message : "That code did not match." }) }
        finally { setLoading(false) }
    }, [code, loading])
    return <StepFrame context={context} step="verify-email" title="Verify your email" description={`Enter the code sent to ${context.email}. Only the newest code will work.`}>
        <form onSubmit={(event) => { event.preventDefault(); void submit() }}>
            <OtpField value={code} onChange={setCode} onComplete={(value) => void submit(value)} disabled={loading} invalid={message.tone === "red"} />
            <AuthFieldFeedback tone={message.tone} message={message.text} />
            <button type="submit" disabled={loading || code.length !== 6} className={`${authPrimaryButton} mt-6`}>{loading ? "Verifying…" : "Verify email"}</button>
        </form>
        <button type="button" disabled={loading || seconds > 0} onClick={async () => { setLoading(true); try { await postOnboarding("resend-signup"); setSeconds(60); setMessage({ tone: "green", text: "A fresh code has been sent." }) } catch (reason) { setMessage({ tone: "red", text: reason instanceof Error ? reason.message : "A fresh code could not be sent." }) } finally { setLoading(false) } }} className={`${authSecondaryButton} mt-3`}>{seconds ? `Send a fresh code in ${seconds}s` : "Send a fresh code"}</button>
    </StepFrame>
}

const intendedUses = [
    ["communications", "Team and client communications"], ["point-of-sale", "Point of sale"], ["onboarding", "Client onboarding"],
    ["operations", "Business operations"], ["just-exploring", "Just exploring"], ["prefer-not-to-say", "Prefer not to say"],
] as const
const roles = [["owner", "Owner or founder"], ["operations", "Operations"], ["sales", "Sales"], ["client-services", "Client services"], ["other", "Something else"], ["prefer-not-to-say", "Prefer not to say"]] as const

function AboutStep({ context }: { context: OnboardingContext }) {
    const [selected, setSelected] = useState<string[]>([])
    const [role, setRole] = useState("")
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    return <StepFrame context={context} step="about" title="What brings you to Betelgeze?" description="These answers help us understand how teams use Betelgeze. They do not change your account, permissions, or setup.">
        <form onSubmit={async (event) => { event.preventDefault(); setLoading(true); setError(null); try { const result = await postOnboarding("about", { intendedUses: selected, roleAnswer: role || "prefer-not-to-say" }); if (result.next) window.location.assign(result.next) } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save this step.") } finally { setLoading(false) } }}>
            <fieldset><legend className="text-sm font-medium text-neutral-200">What will you use it for?</legend><div className="mt-3 grid gap-2">{intendedUses.map(([value, label]) => <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2.5 text-sm text-neutral-200 hover:border-neutral-600"><input type="checkbox" checked={selected.includes(value)} onChange={(event) => setSelected((current) => event.target.checked ? value === "prefer-not-to-say" ? [value] : [...current.filter((item) => item !== "prefer-not-to-say" && item !== value), value] : current.filter((item) => item !== value))} className="h-4 w-4 accent-emerald-300" />{label}</label>)}</div></fieldset>
            <fieldset className="mt-6"><legend className="text-sm font-medium text-neutral-200">Which best describes your role?</legend><select value={role} onChange={(event) => setRole(event.target.value)} className={authInput}><option value="">Choose an answer</option>{roles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></fieldset>
            <AuthFieldFeedback tone="grey" message="Analytics only — never used for access decisions." />
            {error ? <AuthFieldFeedback tone="red" message={error} /> : null}
            <button disabled={loading} className={`${authPrimaryButton} mt-6`}>{loading ? "Saving…" : "Continue"}</button>
        </form>
    </StepFrame>
}

function ProfileStep({ context }: { context: OnboardingContext }) {
    const [preview, setPreview] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    return <StepFrame context={context} step="profile" title="Make the account yours" description="Both fields are optional. You can change them later from your profile.">
        <form encType="multipart/form-data" onSubmit={async (event) => {
            event.preventDefault(); setLoading(true); setError(null)
            const data = new FormData(event.currentTarget); data.set("action", "profile")
            try { const response = await fetch("/api/account/onboarding", { method: "POST", body: data }); const result = await response.json() as ApiResult; if (!response.ok) throw new Error(result.error ?? "Could not save your profile."); if (result.next) window.location.assign(result.next) }
            catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save your profile.") }
            finally { setLoading(false) }
        }}>
            <label htmlFor="display-name" className="text-sm font-medium text-neutral-200">Display name <span className="font-normal text-neutral-500">Optional</span></label>
            <input id="display-name" name="displayName" maxLength={50} autoComplete="name" placeholder={context.usernameCandidate ?? usernameFromEmail(context.email)} className={authInput} />
            <AuthFieldFeedback tone="grey" message="Shown to teammates and clients in communications." />
            <label htmlFor="profile-avatar" className="mt-5 block text-sm font-medium text-neutral-200">Profile picture <span className="font-normal text-neutral-500">Optional</span></label>
            <label htmlFor="profile-avatar" className="mt-3 flex cursor-pointer items-center gap-4 rounded-xl border border-dashed border-neutral-700 bg-neutral-950 p-4 hover:border-neutral-500">
                <span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-neutral-800 text-sm text-neutral-400">{preview ? <img src={preview} alt="Selected profile preview" className="h-full w-full object-cover" /> : "Photo"}</span>
                <span><span className="block text-sm font-medium text-neutral-200">Choose an image</span><span className="mt-1 block text-xs text-neutral-500">PNG, JPEG, WebP, AVIF, GIF, or HEIC · 10MB max</span></span>
            </label>
            <input id="profile-avatar" name="avatar" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/heic,image/heif" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (preview) URL.revokeObjectURL(preview); setPreview(file ? URL.createObjectURL(file) : null) }} />
            {error ? <AuthFieldFeedback tone="red" message={error} /> : null}
            <button disabled={loading} className={`${authPrimaryButton} mt-6`}>{loading ? "Saving…" : "Continue"}</button>
        </form>
    </StepFrame>
}

function TwoFactorStep({ context }: { context: OnboardingContext }) {
    const router = useRouter()
    const onVerified = useCallback(() => { router.replace("/sign-up/complete"); router.refresh() }, [router])
    return <StepFrame context={context} step="2fa" title="Secure your account" description="Two-factor authentication is required for every Betelgeze account before workspace access."><MfaGuide onVerified={onVerified} setupLabel="Betelgeze primary" /></StepFrame>
}

function CompleteStep({ context }: { context: OnboardingContext }) {
    const [status, setStatus] = useState<{ tone: "yellow" | "green" | "red"; message: string }>({ tone: "yellow", message: "Confirming your workspace membership…" })
    const [retry, setRetry] = useState(0)
    useEffect(() => {
        let cancelled = false
        void fetch("/api/account/onboarding/complete", { method: "POST" }).then(async (response) => {
            const body = await response.json() as { next?: string; error?: string; code?: string }
            if (cancelled) return
            if (!response.ok) {
                if (body.code === "aal2_required") { window.location.assign(`/mfa?next=${encodeURIComponent("/sign-up/complete")}`); return }
                setStatus({ tone: "red", message: body.error ?? "Workspace membership could not be completed." }); return
            }
            setStatus({ tone: "green", message: "Account secured and invitation accepted." })
            window.setTimeout(() => window.location.assign(body.next ?? "/workspaces"), 450)
        }).catch(() => { if (!cancelled) setStatus({ tone: "red", message: "The final check was interrupted. Your progress is safe." }) })
        return () => { cancelled = true }
    }, [retry])
    return <AuthFlowShell step="complete" showProgress={false} eyebrow="Setup complete" title="Welcome to Betelgeze" description={`We’re finishing your ${context.workspaceName} membership and opening your profile.`}><div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4"><AuthFieldFeedback tone={status.tone} message={status.message} /></div>{status.tone === "red" ? <button type="button" onClick={() => { setStatus({ tone: "yellow", message: "Trying the final check again…" }); setRetry((value) => value + 1) }} className={`${authPrimaryButton} mt-6`}>Try again</button> : null}</AuthFlowShell>
}

export function AccountOnboardingFlow({ context, step }: { context: OnboardingContext; step: AuthStep }) {
    switch (step) {
        case "review": return <ReviewStep context={context} />
        case "email": return <EmailStep context={context} />
        case "username": return <UsernameStep context={context} />
        case "password": return <PasswordStep context={context} />
        case "verify-email": return <VerifyEmailStep context={context} />
        case "about": return <AboutStep context={context} />
        case "profile": return <ProfileStep context={context} />
        case "2fa": return <TwoFactorStep context={context} />
        case "complete": return <CompleteStep context={context} />
    }
}
