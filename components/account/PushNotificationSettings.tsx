"use client"

import { useEffect, useState } from "react"

type PushSettingsResponse = {
    configured?: boolean
    publicKey?: string | null
    subscribed?: boolean
    error?: string
}

type State = "loading" | "off" | "on" | "saving" | "blocked" | "install" | "unsupported" | "unavailable" | "error"

function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
}

function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
}

function applicationServerKey(value: string) {
    const padding = "=".repeat((4 - value.length % 4) % 4)
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/")
    const raw = window.atob(base64)
    return Uint8Array.from(raw, (character) => character.charCodeAt(0))
}

export function PushNotificationSettings() {
    const [state, setState] = useState<State>("loading")
    const [publicKey, setPublicKey] = useState<string | null>(null)
    const [detail, setDetail] = useState("Checking this device…")

    useEffect(() => {
        let cancelled = false
        async function inspect() {
            if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
                if (!cancelled) { setState("unsupported"); setDetail("This browser does not support Web Push notifications.") }
                return
            }
            if (isIos() && !isStandalone()) {
                if (!cancelled) { setState("install"); setDetail("Add Betelgeze to your Home Screen, open the installed app, then enable notifications here.") }
                return
            }
            const response = await fetch("/api/push/subscriptions", { cache: "no-store" })
            const result = await response.json().catch(() => null) as PushSettingsResponse | null
            if (cancelled) return
            if (!response.ok) { setState("error"); setDetail(result?.error ?? "Could not check notification settings."); return }
            if (!result?.configured || !result.publicKey) { setState("unavailable"); setDetail("Chat notifications are not configured on this Betelgeze deployment yet."); return }
            setPublicKey(result.publicKey)
            if (Notification.permission === "denied") { setState("blocked"); setDetail("Notifications are blocked. Allow Betelgeze in this device’s browser or notification settings."); return }
            setState(result.subscribed ? "on" : "off")
            setDetail(result.subscribed ? "This device will notify you when none of your devices has Communications open." : "Enable notifications for chats on this device.")
        }
        void inspect().catch(() => { if (!cancelled) { setState("error"); setDetail("Could not check notification settings.") } })
        return () => { cancelled = true }
    }, [])

    async function enable() {
        if (!publicKey || state === "saving") return
        setState("saving")
        setDetail(Notification.permission === "default" ? "Opening this device’s notification permission prompt…" : "Enabling notifications on this device…")
        try {
            const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission
            if (permission !== "granted") {
                setState("blocked")
                setDetail("Notifications were not allowed. Enable Betelgeze in this device’s browser or notification settings, then try again.")
                return
            }
            let registration = await navigator.serviceWorker.getRegistration("/")
            if (!registration) registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
            const existing = await registration.pushManager.getSubscription()
            const subscription = existing ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(publicKey) })
            const response = await fetch("/api/push/subscriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(subscription) })
            const result = await response.json().catch(() => null) as PushSettingsResponse | null
            if (!response.ok) throw new Error(result?.error ?? "Could not save this device.")
            setState("on")
            setDetail("This device will notify you when none of your devices has Communications open.")
        } catch (error) {
            setState("error")
            setDetail(error instanceof Error ? error.message : "Could not enable notifications on this device.")
        }
    }

    async function disable() {
        if (state === "saving") return
        setState("saving")
        setDetail("Disabling notifications on this device…")
        try {
            const response = await fetch("/api/push/subscriptions", { method: "DELETE" })
            const result = await response.json().catch(() => null) as PushSettingsResponse | null
            if (!response.ok) throw new Error(result?.error ?? "Could not disable this device.")
            const registration = await navigator.serviceWorker.getRegistration("/")
            const subscription = await registration?.pushManager.getSubscription()
            if (subscription) await subscription.unsubscribe()
            setState("off")
            setDetail("Enable notifications for chats on this device.")
        } catch (error) {
            setState("error")
            setDetail(error instanceof Error ? error.message : "Could not disable notifications on this device.")
        }
    }

    const enabled = state === "on"
    const disabled = state === "loading" || state === "saving" || state === "install" || state === "unsupported" || state === "unavailable"
    return <section className="mt-7 border-t border-neutral-800 pt-5">
        <div className="flex items-center justify-between gap-5">
            <div>
                <h3 className="font-medium">Chat notifications</h3>
                <p className="mt-1 text-sm text-neutral-400">Native and incoming WhatsApp chats. Notification previews only identify who sent the chat.</p>
            </div>
            <button type="button" role="switch" aria-checked={enabled} aria-label="Chat notifications on this device" disabled={disabled} onClick={() => enabled ? void disable() : void enable()} className={`relative h-7 w-12 shrink-0 rounded-full border transition ${enabled ? "border-white bg-white" : "border-neutral-600 bg-neutral-800"} disabled:cursor-not-allowed disabled:opacity-50`}>
                <span className={`absolute top-0.5 h-5 w-5 rounded-full transition ${enabled ? "left-[1.45rem] bg-black" : "left-0.5 bg-neutral-400"}`} />
            </button>
        </div>
        <p className={`mt-3 text-sm ${state === "error" || state === "blocked" ? "text-red-300" : "text-neutral-500"}`}>{detail}</p>
    </section>
}
