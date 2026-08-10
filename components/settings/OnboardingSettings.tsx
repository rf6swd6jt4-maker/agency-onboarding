"use client"

import Link from "next/link"
import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { publishMandatoryModuleConfiguration, saveMandatoryModuleDraft, saveOnboardingHelpSettings } from "@/app/[workspaceSlug]/settings/onboarding-actions"
import { SortableAuthoringList } from "@/components/onboarding-builder/SortableAuthoringList"
import { RoundPill, SquarePill, Status } from "@/components/ui"
import type { MandatoryModuleConfiguration, OnboardingBookendDefinition, OnboardingHelpSettings, OnboardingModuleSummary } from "@/lib/onboarding/configuration-types"

function BookendCard({ workspaceSlug, bookend }: { workspaceSlug: string; bookend: OnboardingBookendDefinition }) {
    return <article className="rounded-xl border border-neutral-800 bg-black/40 p-4">
        <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h4 className="font-medium capitalize">{bookend.kind}</h4><RoundPill>Locked</RoundPill></div><p className="mt-1 truncate text-sm text-neutral-300">{bookend.title}</p><p className="mt-1 text-xs text-neutral-600">Version {bookend.version} · {bookend.kind === "welcome" ? "future sessions only" : "future and active-incomplete sessions"}</p></div><Link href={`/${workspaceSlug}/onboarding-builder?bookend=${bookend.kind}`} className="shrink-0 rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-200 hover:border-neutral-500">Open in Builder</Link></div>
    </article>
}

function MandatoryModules({ workspaceSlug, modules, configuration, help, schemaReady }: { workspaceSlug: string; modules: OnboardingModuleSummary[]; configuration: MandatoryModuleConfiguration; help: OnboardingHelpSettings; schemaReady: boolean }) {
    const router = useRouter()
    const moduleById = useMemo(() => new Map(modules.map((module) => [module.id, module])), [modules])
    const initialIds = configuration.draftRevisionId ? configuration.draftModuleIds : configuration.publishedModuleIds
    const [ids, setIds] = useState(initialIds)
    const [error, setError] = useState<string | null>(null)
    const [saved, setSaved] = useState(false)
    const [pending, startTransition] = useTransition()
    const dirty = ids.join("|") !== initialIds.join("|")
    const savedDraftDiffersFromPublished = Boolean(configuration.draftRevisionId) && initialIds.join("|") !== configuration.publishedModuleIds.join("|")
    const available = modules.filter((module) => module.status === "published" && !ids.includes(module.id))

    function run(action: () => Promise<{ ok: boolean; error?: string }>) {
        setError(null); setSaved(false)
        startTransition(async () => {
            const result = await action()
            if (!result.ok) { setError(result.error ?? "The configuration could not be saved."); return }
            setSaved(true)
            router.refresh()
        })
    }

    return <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="font-semibold">Mandatory modules</h3><p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-500">These appear once at the start of every new onboarding, before service modules. Publishing affects future sessions only.</p></div>{available.length ? <select aria-label="Add mandatory module" defaultValue="" onChange={(event) => { setIds([...ids, event.target.value]); event.currentTarget.value = "" }} className="h-10 rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white"><option value="" disabled>Add module…</option>{available.map((module) => <option key={module.id} value={module.id}>{module.name}</option>)}</select> : null}</div>
        <div className="mt-4">
            {ids.length ? <SortableAuthoringList items={ids.flatMap((id) => { const moduleDefinition = moduleById.get(id); return moduleDefinition ? [{ id, name: moduleDefinition.name }] : [] })} onChange={(items) => setIds(items.map((item) => item.id))} ariaLabel="Mandatory onboarding module order" disabled={!schemaReady} renderItem={(moduleDefinition, _index, handle) => <div className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-black px-2 py-1.5">{handle}<span className="min-w-0 flex-1 truncate text-sm text-neutral-200">{moduleDefinition.name}</span><button type="button" onClick={() => setIds(ids.filter((id) => id !== moduleDefinition.id))} className="h-9 px-2 text-xs text-neutral-500 hover:text-red-300">Remove</button></div>} /> : <p className="rounded-lg border border-dashed border-neutral-800 px-3 py-5 text-center text-sm text-neutral-600">No workspace-mandatory modules.</p>}
        </div>
        {error ? <p role="alert" className="mt-3 text-sm text-red-300">{error}</p> : saved ? <p role="status" className="mt-3 text-sm text-emerald-300">Draft saved.</p> : null}
        <div className="mt-4 flex flex-wrap justify-end gap-2"><button type="button" disabled={pending || !schemaReady || !dirty} onClick={() => run(() => saveMandatoryModuleDraft(workspaceSlug, ids, help.text, help.whatsappEnabled))} className="h-10 rounded-lg border border-neutral-700 px-3 text-sm text-neutral-200 disabled:opacity-30">{pending ? "Saving…" : "Save draft"}</button><button type="button" disabled={pending || !schemaReady || dirty || !savedDraftDiffersFromPublished} onClick={() => run(() => publishMandatoryModuleConfiguration(workspaceSlug))} className="h-10 rounded-lg bg-white px-3 text-sm font-medium text-black disabled:opacity-30">Publish for future sessions</button></div>
    </section>
}

function HelpSettings({ workspaceSlug, help, schemaReady }: { workspaceSlug: string; help: OnboardingHelpSettings; schemaReady: boolean }) {
    const router = useRouter()
    const [value, setValue] = useState(help.text)
    const [whatsappEnabled, setWhatsappEnabled] = useState(help.whatsappEnabled)
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    return <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 sm:p-5">
        <h3 className="font-semibold">Client help</h3><p className="mt-1 text-sm leading-6 text-neutral-500">Shown beside onboarding steps. Saving publishes this help independently without publishing pending mandatory-module changes. The WhatsApp action appears only while the real workspace connection remains verified.</p>
        <label className="mt-4 block text-sm text-neutral-300">Help text<textarea value={value} onChange={(event) => setValue(event.target.value)} rows={3} maxLength={2_000} className="mt-2 w-full rounded-lg border border-neutral-700 bg-black px-3 py-2 text-white" /></label>
        <div className="mt-3 flex items-center gap-2"><Status label={help.whatsappVerified ? "WhatsApp verified" : "WhatsApp unavailable"} tone={help.whatsappVerified ? "green" : "red"} />{help.whatsappVerified && help.whatsappNumber ? <span className="text-xs text-neutral-600">{help.whatsappNumber}</span> : null}</div>
        <label className="mt-3 flex min-h-11 items-center gap-3 rounded-lg border border-neutral-800 bg-black px-3 text-sm text-neutral-300"><input type="checkbox" checked={whatsappEnabled} disabled={!help.whatsappVerified} onChange={(event) => setWhatsappEnabled(event.target.checked)} className="h-4 w-4 accent-white disabled:opacity-40" /><span>Show the verified WhatsApp help action</span></label>
        {error ? <p role="alert" className="mt-3 text-sm text-red-300">{error}</p> : null}
        <div className="mt-4 flex justify-end"><button type="button" disabled={pending || !schemaReady || (value.trim() === help.text.trim() && whatsappEnabled === help.whatsappEnabled)} onClick={() => { setError(null); startTransition(async () => { const outcome = await saveOnboardingHelpSettings(workspaceSlug, value, whatsappEnabled); if (!outcome.ok) setError(outcome.error); else router.refresh() }) }} className="h-10 rounded-lg bg-white px-4 text-sm font-medium text-black disabled:opacity-30">{pending ? "Publishing…" : "Save live help settings"}</button></div>
    </section>
}

export function OnboardingSettings({ workspaceSlug, modules, mandatory, welcome, completion, help, schemaReady }: {
    workspaceSlug: string
    modules: OnboardingModuleSummary[]
    mandatory: MandatoryModuleConfiguration
    welcome: OnboardingBookendDefinition
    completion: OnboardingBookendDefinition
    help: OnboardingHelpSettings
    schemaReady: boolean
}) {
    return <div className="space-y-5">
        <section className="flex flex-col gap-4 rounded-2xl border border-neutral-700 bg-gradient-to-br from-neutral-900 to-black p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"><div><h3 className="font-semibold">Build the client journey</h3><p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-400">Create reusable modules, form and video steps, and test the exact screen clients will use.</p></div><Link href={`/${workspaceSlug}/onboarding-builder`} className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg bg-white px-4 text-sm font-medium text-black">Open Onboarding Builder</Link></section>
        {!schemaReady ? <p className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-100">The new configuration schema is not available in this environment yet. Compatible definitions are shown read-only until deployment completes.</p> : null}
        <MandatoryModules workspaceSlug={workspaceSlug} modules={modules} configuration={mandatory} help={help} schemaReady={schemaReady} />
        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 sm:p-5"><h3 className="font-semibold">Session bookends</h3><p className="mt-1 text-sm leading-6 text-neutral-500">Welcome and Completion are required singleton steps. They cannot be removed.</p><div className="mt-4 grid gap-3 xl:grid-cols-2"><BookendCard workspaceSlug={workspaceSlug} bookend={welcome} /><BookendCard workspaceSlug={workspaceSlug} bookend={completion} /></div></section>
        <section className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900"><div className="flex items-start justify-between gap-4 border-b border-neutral-800 p-4 sm:p-5"><div><h3 className="font-semibold">Published module catalogue</h3><p className="mt-1 text-sm leading-6 text-neutral-500">Usage is resolved from active service revisions and the mandatory configuration.</p></div><Link href={`/${workspaceSlug}/onboarding-builder`} className="shrink-0 text-sm text-neutral-300 underline underline-offset-4">Manage modules</Link></div><div className="divide-y divide-neutral-800">{modules.map((module) => <Link key={module.id} href={`/${workspaceSlug}/onboarding-builder?module=${encodeURIComponent(module.id)}`} className="block bg-black/30 px-4 py-3 transition hover:bg-neutral-800/70 sm:px-5"><span className="flex min-w-0 items-center gap-2"><span className="min-w-0 flex-1 truncate font-medium text-white">{module.name}</span>{module.isTest ? <SquarePill tone="yellow">Test</SquarePill> : null}{module.mandatory ? <RoundPill tone="violet">Mandatory</RoundPill> : null}<Status label={module.status === "published" ? `Published v${module.version}` : module.status === "archived" ? "Archived" : "Draft"} tone={module.status === "published" ? "green" : module.status === "draft" ? "yellow" : "grey"} className="ml-auto shrink-0" /></span><span className="mt-2 flex min-w-0 items-center gap-2 text-xs text-neutral-500"><span className="shrink-0">{module.stepCount} step{module.stepCount === 1 ? "" : "s"} · {module.fieldCount} field{module.fieldCount === 1 ? "" : "s"}</span><span className="min-w-0 flex-1 truncate">{module.usedBy.length ? `Used by: ${module.usedBy.map((service) => service.name).join(", ")}` : "Not used by an active service"}</span></span></Link>)}{!modules.length ? <p className="p-5 text-sm text-neutral-500">No modules have been published yet.</p> : null}</div></section>
        <HelpSettings workspaceSlug={workspaceSlug} help={help} schemaReady={schemaReady} />
    </div>
}
