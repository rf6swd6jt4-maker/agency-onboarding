"use client"

import { useState } from "react"
import { WorkspaceActionButton } from "@/components/workspace/WorkspaceActionButton"

type OfficerOption = { id: string; label: string }
type OfficerCategory = { key: string; label: string; value: string }

export function WorkspaceOfficerSettings({
    globalValue,
    categories,
    officers,
    action,
}: {
    globalValue: string
    categories: OfficerCategory[]
    officers: OfficerOption[]
    action: (formData: FormData) => Promise<void>
}) {
    const [globalOfficer, setGlobalOfficer] = useState(globalValue)
    const [categoryOfficers, setCategoryOfficers] = useState<Record<string, string>>(() =>
        Object.fromEntries(categories.map((category) => [category.key, category.value]))
    )

    return <form action={action} data-workspace-mutation="background" className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900">
        <div className="border-b border-neutral-800 p-4 sm:p-5">
            <label className="block text-sm font-medium text-neutral-200">
                Global officer
                <select name="global" value={globalOfficer} onChange={(event) => setGlobalOfficer(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm text-white">
                    <option value="">No global override</option>
                    {officers.map((officer) => <option key={officer.id} value={officer.id}>{officer.label}</option>)}
                </select>
            </label>
            <p className="mt-2 text-xs leading-5 text-neutral-500">When selected, this officer receives all new maintenance Work Items. The category choices below stay saved and resume automatically when the global override is cleared.</p>
        </div>
        <div className="p-4 sm:p-5">
            <div>
                <h3 className="text-base font-semibold text-neutral-200">Responsible officers</h3>
                <p className="mt-1 text-sm leading-6 text-neutral-500">Used when there is no global officer. Unassigned categories fall back to the workspace owner.</p>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {categories.map((category) => <label key={category.key} className="text-sm text-neutral-300">{category.label}<select name={category.key} value={categoryOfficers[category.key] ?? ""} onChange={(event) => setCategoryOfficers((current) => ({ ...current, [category.key]: event.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-white"><option value="">Workspace owner (fallback)</option>{officers.map((officer) => <option key={officer.id} value={officer.id}>{officer.label}</option>)}</select></label>)}
            </div>
            <WorkspaceActionButton pendingLabel="Saving officers…" className="mt-5 inline-flex min-h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-medium leading-none text-black transition hover:bg-neutral-200">Save officers</WorkspaceActionButton>
        </div>
    </form>
}
