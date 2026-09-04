"use client"

import type { AgencyPublicBranding } from "@/lib/client-branding/public-branding"
import { WorkspaceAutosaveForm } from "@/components/workspace/WorkspaceAutosaveForm"

const inputClass = "mt-2 h-11 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm text-white outline-none focus:border-neutral-500"
const textareaClass = "mt-2 min-h-24 w-full resize-y rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-sm leading-6 text-white outline-none focus:border-neutral-500"

export function AgencyPublicBrandingFields({
    branding,
    saveAction,
}: {
    branding: AgencyPublicBranding
    saveAction: (formData: FormData) => Promise<{ ok: true } | { ok: false; error: string }>
}) {
    return <WorkspaceAutosaveForm action={saveAction}>
        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 sm:p-5">
            <div className="grid gap-4 lg:grid-cols-2">
                <label className="block text-sm text-neutral-300">
                    Agency display name
                    <input name="agency_display_name" required minLength={2} maxLength={100} defaultValue={branding.displayName} autoComplete="organization" className={inputClass} />
                    <span className="mt-1.5 block text-xs leading-5 text-neutral-500">Use the public sender name clients recognize and that your website and messaging registration support.</span>
                </label>
                <label className="block text-sm text-neutral-300">
                    Page title name
                    <input name="agency_metadata_title" minLength={2} maxLength={100} placeholder={branding.displayName} defaultValue={branding.metadataTitle ?? ""} className={inputClass} />
                    <span className="mt-1.5 block text-xs leading-5 text-neutral-500">Optional. Page purposes are added automatically, for example “{branding.metadataTitle ?? branding.displayName} SMS opt-in”.</span>
                </label>
                <label className="block text-sm text-neutral-300">
                    Privacy policy URL
                    <input name="agency_privacy_policy_url" type="url" inputMode="url" maxLength={2000} placeholder="https://www.example.com/privacy" defaultValue={branding.privacyPolicyUrl ?? ""} className={inputClass} />
                </label>
                <label className="block text-sm text-neutral-300">
                    Terms of service URL
                    <input name="agency_terms_of_service_url" type="url" inputMode="url" maxLength={2000} placeholder="https://www.example.com/terms" defaultValue={branding.termsOfServiceUrl ?? ""} className={inputClass} />
                </label>
                <label className="block text-sm text-neutral-300 lg:col-span-2">
                    Page description
                    <textarea name="agency_metadata_description" minLength={10} maxLength={300} placeholder={`Client services from ${branding.displayName}.`} defaultValue={branding.metadataDescription ?? ""} className={textareaClass} />
                    <span className="mt-1.5 block text-xs leading-5 text-neutral-500">Optional. Used by search engines and link previews; each page has an agency-specific fallback.</span>
                </label>
            </div>
        </section>
    </WorkspaceAutosaveForm>
}
