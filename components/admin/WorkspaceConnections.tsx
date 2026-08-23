"use client"

import { FormEvent, ReactNode, useEffect, useRef, useState, useTransition } from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import { runWorkspaceMutation } from "@/lib/workspace-mutations"
import { Status, type StatusTone } from "@/components/ui"
import type { IntegrationProvider, WorkspaceConnection } from "@/lib/workspace-integrations"
import type { WorkspaceConnectionActionResult } from "@/app/[workspaceSlug]/settings/actions"

type Action = (provider: IntegrationProvider) => Promise<WorkspaceConnectionActionResult>
type ManualAction = (provider: IntegrationProvider, formData: FormData) => Promise<WorkspaceConnectionActionResult>
type WhatsAppAction = (input: { code: string; wabaId: string; phoneNumberId: string; consentTemplateName: string; consentTemplateLanguage: string }) => Promise<WorkspaceConnectionActionResult>
type Props = {
    workspaceSlug: string
    connections: WorkspaceConnection[]
    action?: (provider: IntegrationProvider, formData: FormData) => Promise<void>
    verifyAction: Action
    manualAction: ManualAction
    completeWhatsAppAction: WhatsAppAction
    verifyPendingAction: Action
    discardPendingAction: Action
    rollbackAction: Action
    disconnectAction: Action
    canManage: boolean
    metaAppId: string | null
    metaEmbeddedSignupConfigId: string | null
    showHeader?: boolean
}

declare global {
    interface Window {
        FB?: {
            init: (options: Record<string, unknown>) => void
            login: (callback: (response: { authResponse?: { code?: string } }) => void, options: Record<string, unknown>) => void
        }
        fbAsyncInit?: () => void
    }
}

const titles: Record<IntegrationProvider, string> = { stripe: "Stripe", meta_whatsapp: "WhatsApp", twilio_sms: "Twilio" }
const descriptions: Record<IntegrationProvider, string> = {
    stripe: "Create invoices and receive payment events from this agency's Stripe account.",
    meta_whatsapp: "Send confirmations and onboarding links from this agency's WhatsApp number.",
    twilio_sms: "Send and receive SMS/MMS from this agency's Twilio number.",
}

const inputClass = "mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white outline-none focus:border-neutral-400"

function statusFor(connection: WorkspaceConnection): { label: string; tone: StatusTone } {
    const status = connection.connection_status ?? (connection.enabled ? "connected" : "not_connected")
    if (status === "connected") return { label: connection.auth_method === "legacy" || connection.mode === "platform_legacy" ? "Legacy connection active" : "Connected", tone: "green" }
    if (status === "connecting") return { label: "Connecting", tone: "yellow" }
    if (status === "needs_attention") return { label: "Needs attention", tone: "yellow" }
    if (status === "degraded") return { label: "Temporarily degraded", tone: "red" }
    return { label: "Not connected", tone: "grey" }
}

function connectionDetail(connection: WorkspaceConnection) {
    const hint = connection.config_hint ?? {}
    if (connection.provider === "stripe") return [hint.account_name, hint.account_id, hint.mode].filter(Boolean).join(" · ")
    if (connection.provider === "meta_whatsapp") return [hint.display_phone_number ?? hint.phone_number_id, hint.verified_name].filter(Boolean).join(" · ")
    return [hint.phone_number, hint.friendly_name, hint.account_sid].filter(Boolean).join(" · ")
}

function Modal({ title, description, error, onClose, children }: { title: string; description: string; error: string | null; onClose: () => void; children: ReactNode }) {
    if (typeof document === "undefined") return null
    return createPortal(<div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[110] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
        <div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-neutral-700 bg-neutral-950 shadow-2xl shadow-black/70">
            <div className="sticky top-0 z-10 flex items-start gap-4 border-b border-neutral-800 bg-neutral-950/95 px-4 py-4 backdrop-blur sm:px-5">
                <div className="min-w-0 flex-1"><h2 className="text-lg font-semibold text-white">{title}</h2><p className="mt-1 text-sm leading-5 text-neutral-500">{description}</p></div>
                <button type="button" onClick={onClose} aria-label="Close" className="rounded px-2 py-1 text-xl text-neutral-500 hover:bg-neutral-900 hover:text-white">×</button>
            </div>
            {error ? <div role="alert" className="mx-4 mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm leading-5 text-red-200 sm:mx-5">{error}</div> : null}
            {children}
        </div>
    </div>, document.body)
}

function CapabilityList({ connection }: { connection: WorkspaceConnection }) {
    const labels: Record<string, string> = connection.provider === "stripe"
        ? { account_access: "Account accessible", invoice_access: "Invoice access granted", webhook_routing: "Payment events routed" }
        : connection.provider === "meta_whatsapp"
            ? { phone_access: "Phone number accessible", outbound_messages: "Outbound messaging allowed", webhook_subscribed: "Incoming events routed", consent_template_approved: "Confirmation template approved" }
            : { phone_access: "Phone number accessible", outbound_messages: "Outbound SMS allowed", webhook_subscribed: "Incoming messages routed", mms: "MMS media supported" }
    const capabilities = connection.capabilities ?? (connection.config_hint?.capabilities as Record<string, unknown> | undefined) ?? {}
    return <div className="grid gap-2 sm:grid-cols-2">{Object.entries(labels).map(([key, label]) => <div key={key} className="flex items-center gap-2 text-sm text-neutral-300"><Status compact label={capabilities[key] ? "Ready" : "Not verified"} tone={capabilities[key] ? "green" : "grey"} /><span>{label}</span></div>)}</div>
}

function ManualFields({ provider }: { provider: IntegrationProvider }) {
    if (provider === "stripe") return <>
        <label className="block text-sm text-neutral-300">Restricted or secret key<input className={inputClass} name="secret_key" type="password" required placeholder="rk_live_… or sk_live_…" /></label>
        <label className="block text-sm text-neutral-300">Webhook signing secret<input className={inputClass} name="webhook_secret" type="password" required placeholder="whsec_…" /></label>
        <label className="block text-sm text-neutral-300">Default currency<input className={inputClass} name="default_currency" defaultValue="usd" maxLength={3} required /></label>
    </>
    if (provider === "meta_whatsapp") return <>
        <label className="block text-sm text-neutral-300">Permanent access token<input className={inputClass} name="access_token" type="password" required /></label>
        <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm text-neutral-300">Phone number ID<input className={inputClass} name="phone_number_id" required /></label><label className="block text-sm text-neutral-300">WhatsApp Business Account ID<input className={inputClass} name="waba_id" required /></label></div>
        <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm text-neutral-300">Confirmation template<input className={inputClass} name="consent_template_name" required placeholder="onboarding_confirmation" /></label><label className="block text-sm text-neutral-300">Template language<input className={inputClass} name="consent_template_language" required defaultValue="en_US" /></label></div>
    </>
    return <>
        <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm text-neutral-300">Account SID<input className={inputClass} name="account_sid" required placeholder="AC…" autoComplete="off" /></label><label className="block text-sm text-neutral-300">Auth Token<input className={inputClass} name="auth_token" type="password" required autoComplete="new-password" /></label></div>
        <label className="block text-sm text-neutral-300">Twilio phone number<input className={inputClass} name="phone_number" type="tel" required placeholder="+15551234567" /></label>
    </>
}

export function WorkspaceConnections({ workspaceSlug, connections, verifyAction, manualAction, completeWhatsAppAction, verifyPendingAction, discardPendingAction, rollbackAction, disconnectAction, canManage, metaAppId, metaEmbeddedSignupConfigId, showHeader = true }: Props) {
    const router = useRouter()
    const [selected, setSelected] = useState<IntegrationProvider | null>(null)
    const [advanced, setAdvanced] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    const [stripeMode, setStripeMode] = useState<"test" | "live">("live")
    const [templateName, setTemplateName] = useState("onboarding_confirmation")
    const [templateLanguage, setTemplateLanguage] = useState("en_US")
    const popupRef = useRef<Window | null>(null)

    useEffect(() => {
        if (!metaAppId || document.getElementById("meta-jssdk")) return
        window.fbAsyncInit = () => window.FB?.init({ appId: metaAppId, autoLogAppEvents: true, xfbml: true, version: "v25.0" })
        const script = document.createElement("script")
        script.id = "meta-jssdk"
        script.async = true
        script.defer = true
        script.crossOrigin = "anonymous"
        script.src = "https://connect.facebook.net/en_US/sdk.js"
        document.body.appendChild(script)
    }, [metaAppId])

    useEffect(() => {
        const receive = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return
            if (event.data?.type !== "betelgeze:connection") return
            if (event.data.provider !== "stripe") return
            popupRef.current = null
            if (event.data.ok) { setError(null); setSelected(null); router.refresh() }
            else setError(event.data.error || "Stripe could not be connected.")
        }
        window.addEventListener("message", receive)
        return () => window.removeEventListener("message", receive)
    }, [router])

    const connection = selected ? connections.find((item) => item.provider === selected) ?? null : null

    function run(action: () => Promise<WorkspaceConnectionActionResult>, close = false) {
        setError(null)
        startTransition(async () => {
            const result = await runWorkspaceMutation(action, { category: "integrations" })
            if (!result.ok) { setError(result.error); return }
            if (close) setSelected(null)
            router.refresh()
        })
    }

    function submitManual(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (!selected) return
        const formData = new FormData(event.currentTarget)
        run(() => manualAction(selected, formData), true)
    }

    function startStripe() {
        setError(null)
        const width = 620
        const height = 760
        const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2)
        const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2)
        popupRef.current = window.open(`/api/workspace-connections/stripe/start?workspace=${encodeURIComponent(workspaceSlug)}&mode=${stripeMode}`, "betelgeze-stripe-connect", `popup=yes,width=${width},height=${height},left=${left},top=${top}`)
        if (!popupRef.current) setError("Your browser blocked the Stripe popup. Allow popups for Betelgeze and try again.")
    }

    function startWhatsApp() {
        setError(null)
        if (!window.FB || !metaEmbeddedSignupConfigId) {
            setError("Automatic WhatsApp signup is not configured yet. Use the secure manual connection below.")
            setAdvanced(true)
            return
        }
        const session = new Promise<{ wabaId: string; phoneNumberId: string }>((resolve, reject) => {
            const timeout = window.setTimeout(() => { window.removeEventListener("message", receive); reject(new Error("Meta did not return the selected WhatsApp number. Try again.")) }, 30_000)
            const receive = (event: MessageEvent) => {
                let eventHost = ""
                try { eventHost = new URL(event.origin).hostname } catch { return }
                if (eventHost !== "facebook.com" && !eventHost.endsWith(".facebook.com")) return
                let payload = event.data
                if (typeof payload === "string") { try { payload = JSON.parse(payload) } catch { return } }
                if (payload?.type !== "WA_EMBEDDED_SIGNUP") return
                if (payload.event === "FINISH") {
                    window.clearTimeout(timeout)
                    window.removeEventListener("message", receive)
                    resolve({ wabaId: payload.data?.waba_id, phoneNumberId: payload.data?.phone_number_id })
                } else if (payload.event === "CANCEL" || payload.event === "ERROR") {
                    window.clearTimeout(timeout)
                    window.removeEventListener("message", receive)
                    reject(new Error(payload.data?.error_message || "WhatsApp signup was cancelled."))
                }
            }
            window.addEventListener("message", receive)
        })
        window.FB.login((response) => {
            const code = response.authResponse?.code
            if (!code) { setError("Meta did not authorize this WhatsApp connection."); return }
            startTransition(async () => {
                try {
                    const selectedSession = await session
                    const result = await runWorkspaceMutation(() => completeWhatsAppAction({ code, ...selectedSession, consentTemplateName: templateName, consentTemplateLanguage: templateLanguage }), { category: "integrations" })
                    if (!result.ok) { setError(result.error); return }
                    setSelected(null)
                    router.refresh()
                } catch (caught) { setError(caught instanceof Error ? caught.message : "WhatsApp could not be connected.") }
            })
        }, { config_id: metaEmbeddedSignupConfigId, response_type: "code", override_default_response_type: true, extras: { setup: {}, sessionInfoVersion: "3" } })
    }

    return <section className={`${showHeader ? "mt-8 " : ""}min-w-0 max-w-full`}>
        {showHeader ? <><h2 className="text-lg font-semibold">Connections</h2><p className="mt-1 text-sm text-neutral-400">Connect each agency&apos;s own provider accounts without exposing credentials.</p></> : null}
        <div className={`${showHeader ? "mt-4 " : ""}grid min-w-0 max-w-full gap-4 md:grid-cols-2 xl:grid-cols-3`}>{connections.map((item) => {
            const state = statusFor(item)
            const detail = connectionDetail(item)
            return <article key={item.provider} className="min-w-0 max-w-full rounded-2xl border border-neutral-800 bg-neutral-900 p-4 sm:p-5">
                <div className="flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:justify-between sm:gap-4"><div className="min-w-0"><h3 className="font-medium text-white">{titles[item.provider]}</h3><p className="mt-1 text-sm leading-5 text-neutral-500">{descriptions[item.provider]}</p></div><Status label={state.label} tone={state.tone} wrap className="max-w-full sm:shrink-0" /></div>
                {detail ? <p className="mt-4 break-all text-sm text-neutral-300">{detail}</p> : null}
                {item.last_error ? <p className="mt-3 break-words text-sm leading-5 text-red-300">{item.last_error}</p> : null}
                <button type="button" disabled={!canManage} onClick={() => { setSelected(item.provider); setAdvanced(false); setError(null) }} className="mt-5 h-10 w-full rounded-lg border border-neutral-700 px-3 text-sm font-medium text-neutral-100 transition hover:border-neutral-500 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40">{item.enabled ? "Manage connection" : "Connect"}</button>
            </article>
        })}</div>
        {!canManage ? <p className="mt-3 text-xs text-neutral-500">Only the workspace owner can connect or disconnect provider accounts.</p> : null}

        {selected && connection ? <Modal title={`Connect ${titles[selected]}`} description="The current connection remains active until the replacement passes every required check." error={error} onClose={() => { if (!pending) setSelected(null) }}>
            <div className="space-y-5 p-4 sm:p-5">
                {connection.enabled ? <div className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-4"><div className="flex items-center justify-between gap-3"><Status {...statusFor(connection)} /><span className="text-xs text-neutral-500">{connection.auth_method === "legacy" || connection.mode === "platform_legacy" ? "Protected fallback" : connection.auth_method?.replace("_", " ")}</span></div>{connectionDetail(connection) ? <p className="mt-3 text-sm text-neutral-300">{connectionDetail(connection)}</p> : null}<div className="mt-4"><CapabilityList connection={connection} /></div></div> : null}

                <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-neutral-500">{connection.last_verified_at ? `Last verified ${new Date(connection.last_verified_at).toLocaleString()}${connection.last_webhook_at ? ` · last webhook ${new Date(connection.last_webhook_at).toLocaleString()}` : ""}` : "Connection has not been re-verified yet"}</p>{connection.enabled ? <button type="button" disabled={pending} onClick={() => run(() => verifyAction(selected))} className="h-8 rounded-lg border border-neutral-700 px-3 text-xs text-neutral-300 transition hover:border-neutral-500 hover:text-white disabled:opacity-50">{pending ? "Verifying…" : "Verify now"}</button> : null}</div>

                {selected === "stripe" ? <div className="rounded-xl border border-neutral-800 p-4"><h3 className="font-medium text-white">Connect with Stripe</h3><p className="mt-1 text-sm leading-6 text-neutral-500">Stripe opens in a separate secure window. Betelgeze receives only the permissions declared by its Stripe App.</p><label className="mt-4 block text-sm text-neutral-300">Account mode<select value={stripeMode} onChange={(event) => setStripeMode(event.target.value as "test" | "live")} className={inputClass}><option value="live">Live account</option><option value="test">Test account</option></select></label><button type="button" disabled={pending} onClick={startStripe} className="mt-4 h-10 w-full rounded-lg bg-white px-4 text-sm font-medium text-black disabled:opacity-50">Continue to Stripe</button></div>
                : selected === "meta_whatsapp" ? <div className="rounded-xl border border-neutral-800 p-4"><h3 className="font-medium text-white">Connect with Meta</h3><p className="mt-1 text-sm leading-6 text-neutral-500">Choose the agency&apos;s Meta business and WhatsApp number. Betelgeze then subscribes its webhook and verifies the confirmation template.</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="block text-sm text-neutral-300">Confirmation template<input value={templateName} onChange={(event) => setTemplateName(event.target.value)} className={inputClass} /></label><label className="block text-sm text-neutral-300">Language<input value={templateLanguage} onChange={(event) => setTemplateLanguage(event.target.value)} className={inputClass} /></label></div><button type="button" disabled={pending || !templateName.trim()} onClick={startWhatsApp} className="mt-4 h-10 w-full rounded-lg bg-white px-4 text-sm font-medium text-black disabled:opacity-50">Continue with Meta</button></div>
                : <div className="rounded-xl border border-neutral-800 p-4"><h3 className="font-medium text-white">Connect a Twilio number</h3><p className="mt-1 text-sm leading-6 text-neutral-500">Use the account SID, Auth Token, and an SMS-capable number owned by that account. Betelgeze verifies the number and configures its incoming-message webhook.</p><button type="button" onClick={() => setAdvanced(true)} className="mt-4 h-10 w-full rounded-lg bg-white px-4 text-sm font-medium text-black">Enter Twilio credentials</button></div>}

                <div className="border-t border-neutral-800 pt-4"><button type="button" onClick={() => setAdvanced((value) => !value)} className="text-sm text-neutral-400 underline decoration-neutral-700 underline-offset-4 hover:text-white">{advanced ? "Hide manual connection" : "Use manual credentials"}</button>{advanced ? <form onSubmit={submitManual} className="mt-4 space-y-3 rounded-xl border border-neutral-800 bg-neutral-900/50 p-4"><p className="text-xs leading-5 text-neutral-500">Credentials are encrypted before storage and are never returned to the browser. The current connection is replaced only after verification succeeds.</p><ManualFields provider={selected} /><button disabled={pending} className="h-10 w-full rounded-lg bg-white px-4 text-sm font-medium text-black disabled:opacity-50">{pending ? "Verifying…" : "Save and verify"}</button></form> : null}</div>

                {connection.candidate_auth_method ? <div className="rounded-xl border border-yellow-700/40 bg-yellow-950/20 p-4"><Status label="Connection waiting for verification" tone="yellow" /><p className="mt-2 text-sm leading-5 text-neutral-400">The active connection has not been changed.</p><div className="mt-3 flex gap-2"><button type="button" disabled={pending} onClick={() => run(() => verifyPendingAction(selected), true)} className="h-9 rounded-lg bg-white px-3 text-sm font-medium text-black disabled:opacity-50">Try verification again</button><button type="button" disabled={pending} onClick={() => run(() => discardPendingAction(selected))} className="h-9 rounded-lg border border-neutral-700 px-3 text-sm text-neutral-300 disabled:opacity-50">Discard</button></div></div> : null}

                {connection.previous_mode ? <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-800 pt-4"><p className="text-sm text-neutral-500">A previous connection is available as a rollback.</p><button type="button" disabled={pending} onClick={() => { if (window.confirm(`Restore the previous ${titles[selected]} connection?`)) run(() => rollbackAction(selected), true) }} className="h-9 rounded-lg border border-neutral-700 px-3 text-sm text-neutral-200 disabled:opacity-50">Restore previous</button></div> : null}
                {connection.enabled && connection.mode !== "platform_legacy" ? <div className="flex flex-wrap items-center justify-between gap-3 border-t border-red-950 pt-4"><div><p className="text-sm font-medium text-red-200">Disconnect {titles[selected]}</p><p className="mt-1 text-xs text-neutral-600">Provider automations will stop immediately.</p></div><button type="button" disabled={pending} onClick={() => { if (window.confirm(`Disconnect ${titles[selected]} from this workspace?`)) run(() => disconnectAction(selected), true) }} className="h-9 rounded-lg border border-red-900 px-3 text-sm text-red-200 disabled:opacity-50">Disconnect</button></div> : null}
            </div>
        </Modal> : null}
    </section>
}
