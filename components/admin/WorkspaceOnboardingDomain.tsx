"use client"

import { useState } from "react"
import { WorkspaceActionButton } from "@/components/workspace/WorkspaceActionButton"

type DnsRecord = {
    type: "A" | "CNAME" | "TXT"
    name: string
    value: string
}

type Props = {
    domain: string | null
    status: "none" | "pending_dns" | "verified"
    records: DnsRecord[]
    error: string | null
    saveAction: (formData: FormData) => Promise<void>
    verifyAction: () => Promise<void>
    cancelAction: () => Promise<void>
    canManage: boolean
}

function DomainSetupForm({ domain, action, onCancel }: { domain: string | null; action: (formData: FormData) => Promise<void>; onCancel: () => void }) {
    return <div className="mt-5 rounded-xl border border-neutral-800 bg-neutral-950/40 p-4 sm:p-5">
        <p className="font-medium">Step 1 of 2: choose a domain</p>
        <p className="mt-1 text-sm text-neutral-400">Use any domain or subdomain you control, such as example.com or onboarding.example.com.</p>
        <form action={action} data-workspace-mutation="background" className="mt-4 space-y-3">
            <label className="block text-sm text-neutral-300">Domain<input name="domain" type="text" defaultValue={domain ?? ""} placeholder="example.com or onboarding.example.com" autoCapitalize="none" autoCorrect="off" spellCheck={false} className="mt-1.5 w-full rounded-lg border border-neutral-700 bg-black px-3 py-2 text-white" /></label>
            <p className="text-xs leading-5 text-neutral-500">Enter only the hostname, without <code>https://</code> or a path. We will provide the DNS records to add at the domain provider.</p>
            <div className="flex flex-wrap gap-2"><WorkspaceActionButton pendingLabel="Saving…" className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black">Continue to DNS setup</WorkspaceActionButton><button type="button" onClick={onCancel} className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300">Cancel</button></div>
        </form>
    </div>
}

export function WorkspaceOnboardingDomain({ domain, status, records, error, saveAction, verifyAction, cancelAction, canManage }: Props) {
    const [setupOpen, setSetupOpen] = useState(false)
    const [copied, setCopied] = useState<string | null>(null)
    const pending = Boolean(domain && status === "pending_dns")
    const verified = Boolean(domain && status === "verified")

    async function copy(value: string, key: string) {
        await navigator.clipboard.writeText(value)
        setCopied(key)
        window.setTimeout(() => setCopied(null), 1_500)
    }

    return <section className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="text-lg font-semibold">Custom onboarding domain</h2>
        <p className="mt-1 text-sm text-neutral-400">Give clients a direct onboarding link on your own domain.</p>

        {!domain && <><p className="mt-4 text-sm text-neutral-500">New links currently use the Betelgeze onboarding URL. No custom domain is connected yet.</p>{canManage && !setupOpen && <button type="button" onClick={() => setSetupOpen(true)} className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black">Connect custom domain</button>}{canManage && setupOpen && <DomainSetupForm domain={null} action={saveAction} onCancel={() => setSetupOpen(false)} />}</>}

        {pending && <div className="mt-4 rounded-lg border border-amber-900/70 bg-amber-950/30 px-3 py-3 text-sm text-amber-100">
            <p className="font-medium">Step 2 of 2: connect DNS</p>
            <p className="mt-1 text-amber-200/80">Add these records at your DNS provider, then connect the domain. New links will keep using Betelgeze until verification succeeds.</p>
            {records.length > 0 ? <div className="mt-3 overflow-x-auto rounded border border-amber-900/70"><table className="min-w-full text-left text-xs"><thead className="bg-amber-950/40 text-amber-200"><tr><th className="px-2 py-1.5">Type</th><th className="px-2 py-1.5">Name</th><th className="px-2 py-1.5">Value</th></tr></thead><tbody>{records.map((record) => { const key = `${record.type}-${record.name}-${record.value}`; return <tr key={key} className="border-t border-amber-900/50"><td className="px-2 py-1.5 font-mono">{record.type}</td><td className="px-2 py-1.5 font-mono"><span className="break-all">{record.name}</span><button type="button" onClick={() => copy(record.name, `${key}-name`)} className="ml-2 rounded border border-amber-800 px-1.5 py-0.5 text-[11px] text-amber-100">{copied === `${key}-name` ? "Copied" : "Copy"}</button></td><td className="px-2 py-1.5 font-mono"><span className="break-all">{record.value}</span><button type="button" onClick={() => copy(record.value, `${key}-value`)} className="ml-2 rounded border border-amber-800 px-1.5 py-0.5 text-[11px] text-amber-100">{copied === `${key}-value` ? "Copied" : "Copy"}</button></td></tr>})}</tbody></table></div> : <p className="mt-3 text-xs text-amber-200/80">No DNS records were returned yet. Choose the domain again to refresh the setup instructions.</p>}
            {error && <p className="mt-3 rounded border border-red-500/40 bg-red-950/40 px-2 py-2 text-xs text-red-200">{error}</p>}
            {canManage && <div className="mt-4 flex flex-wrap gap-2"><form action={verifyAction} data-workspace-mutation="background"><WorkspaceActionButton pendingLabel="Checking…" className="rounded-lg border border-amber-500/50 px-3 py-2 text-sm font-medium text-amber-100">Connect domain</WorkspaceActionButton></form><form action={cancelAction} data-workspace-mutation="background"><WorkspaceActionButton pendingLabel="Cancelling…" confirmMessage="Cancel this custom-domain setup?" className="rounded-lg border border-amber-900/70 px-3 py-2 text-sm text-amber-200">Cancel setup</WorkspaceActionButton></form></div>}
        </div>}

        {verified && <div className="mt-4 rounded-lg border border-emerald-900/70 bg-emerald-950/30 px-3 py-3 text-sm text-emerald-200"><p className="font-medium">Custom domain connected</p><p className="mt-1">New links use <span className="font-medium">https://{domain}/[token]</span>.</p>{canManage && <form action={cancelAction} data-workspace-mutation="background" className="mt-3"><WorkspaceActionButton pendingLabel="Disconnecting…" confirmMessage="Disconnect this custom onboarding domain?" className="rounded-lg border border-emerald-800 px-3 py-2 text-sm text-emerald-100">Disconnect domain</WorkspaceActionButton></form>}</div>}

        {!canManage && <p className="mt-5 text-sm text-neutral-500">Only the workspace owner can change this domain.</p>}
    </section>
}
