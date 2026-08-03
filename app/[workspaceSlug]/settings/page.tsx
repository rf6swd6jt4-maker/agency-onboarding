import { WorkspaceIdentityEditor } from "@/components/admin/WorkspaceIdentityEditor"
import { PendingWorkspaceInvitations } from "@/components/admin/PendingWorkspaceInvitations"
import { WorkspaceConnections } from "@/components/admin/WorkspaceConnections"
import { WorkspaceOnboardingDomain } from "@/components/admin/WorkspaceOnboardingDomain"
import { AdaptiveTargetingSettings } from "@/components/leadgen/AdaptiveTargetingSettings"
import { ManualSettingsForm, SettingsSectionActions } from "@/components/leadgen/ManualSettingsForm"
import { SourceSettingsCard } from "@/components/leadgen/SourceSettingsCard"
import { SettingsSectionNav, type SettingsSectionNavItem } from "@/components/workspace/SettingsSectionNav"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { loadLeadgenSettingsPageData } from "@/lib/leadgen/settings-page-data"
import { createUploadSignedUrl } from "@/lib/onboarding/uploads"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { normalizeWorkspaceRole, requireWorkspace, workspaceRoleLabel } from "@/lib/workspaces"
import type { ReactNode } from "react"
import { saveLeadgenSettings } from "../leadgen/settings/actions"
import { inviteWorkspaceUser, removeWorkspaceUser, updateWorkspaceUserRole } from "../users/actions"
import {
    cancelWorkspaceOnboardingDomain,
    removeWorkspaceInvitation,
    saveWorkspaceConnection,
    saveWorkspaceOnboardingDomain,
    updateWorkspaceCoverLayout,
    updateWorkspaceName,
    uploadWorkspaceBanner,
    uploadWorkspaceLogo,
    verifyWorkspaceConnection,
    verifyWorkspaceOnboardingDomain,
} from "./actions"

export const dynamic = "force-dynamic"

const settingsSections = [
    { id: "workspace", label: "Workspace", detail: "Name and workspace details" },
    { id: "services", label: "Services", detail: "Catalogue and default pricing" },
    { id: "onboarding", label: "Onboarding", detail: "Domain and session builder" },
    { id: "client-portal", label: "Client Portal", detail: "Future portal settings" },
    { id: "agency-branding", label: "Agency Branding", detail: "Shared client-facing identity" },
    { id: "connections", label: "Connections", detail: "Stripe and WhatsApp" },
    { id: "users", label: "Users", detail: "Access and invitations" },
    { id: "leadgen-automation", label: "Lead Gen Automation", detail: "Poll cadence and limits" },
    { id: "leadgen-targeting", label: "Lead Gen Targeting", detail: "Industries and locations" },
    { id: "leadgen-sources", label: "Lead Gen Sources", detail: "Source readiness and controls" },
] satisfies SettingsSectionNavItem[]

function UnifiedSection({
    id,
    title,
    description,
    children,
}: {
    id: string
    title: string
    description: string
    children: ReactNode
}) {
    return (
        <section id={id} className="scroll-mt-5">
            <div className="mb-4">
                <h2 className="text-xl font-semibold tracking-tight text-white">{title}</h2>
                <p className="mt-1 text-sm leading-6 text-neutral-400">{description}</p>
            </div>
            {children}
        </section>
    )
}

function SettingsPlaceholder({
    title,
    description,
}: {
    title: string
    description: string
}) {
    return (
        <div className="rounded-2xl border border-dashed border-neutral-800 bg-neutral-900/45 p-4 sm:p-5">
            <h3 className="text-base font-semibold text-neutral-200">{title}</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">{description}</p>
        </div>
    )
}

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
}

export default async function SettingsPage({ params }: PageProps) {
    const { workspaceSlug } = await params
    const { workspace, role, user } = await requireWorkspace(workspaceSlug, "admin")
    const [
        bannerSrc,
        logoSrc,
        membershipsResult,
        integrationResult,
        leadgenSettings,
    ] = await Promise.all([
        workspace.banner_path ? createUploadSignedUrl(workspace.banner_path) : null,
        workspace.logo_path ? createUploadSignedUrl(workspace.logo_path) : null,
        supabaseAdmin
            .from("workspace_memberships")
            .select("user_id, role, created_at")
            .eq("workspace_id", workspace.id)
            .order("created_at"),
        supabaseAdmin
            .from("workspace_integrations")
            .select("provider, enabled, mode, config_hint")
            .eq("workspace_id", workspace.id),
        loadLeadgenSettingsPageData(workspace.id),
    ])

    const users = await Promise.all((membershipsResult.data ?? []).map(async (membership) => ({
        ...membership,
        user: (await supabaseAdmin.auth.admin.getUserById(membership.user_id)).data.user,
    })))
    const isOwner = role === "owner"
    const connections = ["stripe", "meta_whatsapp"].map((provider) =>
        integrationResult.data?.find((item) => item.provider === provider)
        ?? { provider, enabled: false, mode: "disabled", config_hint: {} }
    ) as Parameters<typeof WorkspaceConnections>[0]["connections"]

    return (
        <main className="min-h-screen bg-neutral-950 px-4 pb-8 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-7xl pt-5">
                <WorkspaceIdentityEditor
                    workspace={{
                        name: workspace.name,
                        slug: workspace.slug,
                        bannerHeight: workspace.banner_height,
                        bannerPosition: workspace.banner_position,
                        bannerSrc,
                        logoSrc,
                    }}
                    updateName={updateWorkspaceName.bind(null, workspace.slug)}
                    updateCoverLayout={updateWorkspaceCoverLayout.bind(null, workspace.slug)}
                    uploadBanner={uploadWorkspaceBanner.bind(null, workspace.slug)}
                    uploadLogo={uploadWorkspaceLogo.bind(null, workspace.slug)}
                    description={null}
                    bannerLabel="workspace banner"
                    displayName="Settings"
                    showNameEditor={false}
                />

                <div className="mt-8 grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)]">
                    <SettingsSectionNav sections={settingsSections} />

                    <div id="workspace-settings-scroll" className="min-w-0 space-y-10 pb-8 lg:pr-2">
                        <UnifiedSection
                            id="workspace"
                            title="Workspace"
                            description="Edit the workspace name shown in the top bar, menus, and account areas."
                        >
                            <form action={updateWorkspaceName.bind(null, workspace.slug)} className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 sm:p-5">
                                <label className="block text-sm text-neutral-300">
                                    Workspace name
                                    <input name="name" required defaultValue={workspace.name} className="mt-2 h-11 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm text-white" />
                                </label>
                                <button className="mt-4 inline-flex min-h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-medium leading-none text-black transition hover:bg-neutral-200">
                                    Save workspace
                                </button>
                            </form>
                        </UnifiedSection>

                        <UnifiedSection
                            id="services"
                            title="Services"
                            description="Manage the services your agency offers and the default prices used when preparing client work."
                        >
                            <SettingsPlaceholder
                                title="Service catalogue"
                                description="Workspace service management and default pricing will be configured here. The current onboarding, invoicing, and fulfilment flows continue using the existing service definitions until that catalogue is introduced."
                            />
                        </UnifiedSection>

                        <UnifiedSection
                            id="onboarding"
                            title="Onboarding"
                            description="Manage the client onboarding domain now, with session structure and form-building controls to follow."
                        >
                            <WorkspaceOnboardingDomain
                                domain={workspace.custom_onboarding_domain}
                                status={workspace.custom_onboarding_domain_status}
                                records={workspace.custom_onboarding_domain_records}
                                error={workspace.custom_onboarding_domain_error}
                                saveAction={saveWorkspaceOnboardingDomain.bind(null, workspace.slug)}
                                verifyAction={verifyWorkspaceOnboardingDomain.bind(null, workspace.slug)}
                                cancelAction={cancelWorkspaceOnboardingDomain.bind(null, workspace.slug)}
                                canManage={role === "owner" || role === "admin"}
                            />
                        </UnifiedSection>

                        <UnifiedSection
                            id="client-portal"
                            title="Client Portal"
                            description="This section will hold the settings for the post-onboarding client experience."
                        >
                            <SettingsPlaceholder
                                title="Client portal settings"
                                description="The client portal is not available yet. Its domain, access, communication, fulfilment progress, and results settings will be added here when the portal is built."
                            />
                        </UnifiedSection>

                        <UnifiedSection
                            id="agency-branding"
                            title="Agency Branding"
                            description="Manage the branding used across onboarding sessions, the future client portal, and other client-facing experiences."
                        >
                            <SettingsPlaceholder
                                title="Client-facing theme"
                                description="Colour controls for onboarding sessions, the future client portal, and other client-facing interfaces will be added here. No configurable client-facing colour theme is active yet."
                            />
                        </UnifiedSection>

                        <UnifiedSection
                            id="connections"
                            title="Connections"
                            description="Manage active provider credentials and verify that the real external path works."
                        >
                            <WorkspaceConnections
                                connections={connections}
                                action={saveWorkspaceConnection.bind(null, workspace.slug)}
                                verifyAction={verifyWorkspaceConnection.bind(null, workspace.slug)}
                                canManage={isOwner}
                                showHeader={false}
                            />
                        </UnifiedSection>

                        <UnifiedSection
                            id="users"
                            title="Users"
                            description="Invite teammates and control workspace access."
                        >
                            <form action={inviteWorkspaceUser.bind(null, workspace.slug)} className="grid gap-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-4 sm:grid-cols-[1fr_auto_auto] sm:p-5">
                                <input name="email" type="email" required placeholder="person@business.com" className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2" />
                                <select name="role" defaultValue="staff" className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2">
                                    <option value="staff">Staff</option>
                                    {isOwner && <option value="admin">Admin</option>}
                                </select>
                                <button className="rounded-lg bg-white px-4 py-2 font-medium text-black">Invite user</button>
                            </form>
                            <div className="mt-5 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900">
                                <PendingWorkspaceInvitations workspaceId={workspace.id} removeAction={removeWorkspaceInvitation.bind(null, workspace.slug)} />
                                {users.map(({ user: workspaceUser, role: assignedRole }) => (
                                    <div key={workspaceUser?.id} className="flex flex-col gap-3 border-b border-neutral-800 p-4 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                                        <div>
                                            <p className="break-words font-medium">{workspaceUser?.email}</p>
                                            <p className="text-sm text-neutral-500">{workspaceRoleLabel(assignedRole)}</p>
                                        </div>
                                        {normalizeWorkspaceRole(assignedRole) !== "owner" && (
                                            <div className="flex flex-wrap gap-2">
                                                {isOwner && (
                                                    <form action={updateWorkspaceUserRole.bind(null, workspace.slug)} className="flex min-w-0 flex-1 gap-2 sm:flex-none">
                                                        <input type="hidden" name="userId" value={workspaceUser?.id} />
                                                        <select name="role" defaultValue={normalizeWorkspaceRole(assignedRole) ?? "staff"} className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm sm:w-auto">
                                                            <option value="staff">Staff</option>
                                                            <option value="admin">Admin</option>
                                                        </select>
                                                        <button className="rounded-lg border border-neutral-700 px-3 py-1 text-sm">Save</button>
                                                    </form>
                                                )}
                                                <form action={removeWorkspaceUser.bind(null, workspace.slug)} className="flex-1 sm:flex-none">
                                                    <input type="hidden" name="userId" value={workspaceUser?.id} />
                                                    <button className="w-full rounded-lg border border-red-900 px-3 py-1 text-sm text-red-300 sm:w-auto">Remove</button>
                                                </form>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </UnifiedSection>

                        <ManualSettingsForm action={saveLeadgenSettings.bind(null, workspace.slug)} className="space-y-10">
                            <UnifiedSection
                                id="leadgen-automation"
                                title="Lead Gen Automation"
                                description="Set polling cadence, candidate volume, and owner-evidence defaults."
                            >
                                <div data-settings-section="poll-options" className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 sm:p-5">
                                    <input type="hidden" name="settingsScope" value="settings" />
                                    <h3 className="text-lg font-semibold leading-6">Poll Automation</h3>
                                    <p className="mt-1.5 text-sm leading-5 text-neutral-400">Cadence, run limits, and automated polling defaults.</p>
                                    <div className="mt-4 grid gap-3">
                                        <label className="block text-sm text-neutral-300">
                                            Automatic poll interval
                                            <input name="pollIntervalHours" type="number" min={1} max={2160} defaultValue={leadgenSettings.settings?.poll_interval_hours ?? 168} className="mt-2 h-10 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm text-white" />
                                            <span className="mt-1.5 block text-xs leading-5 text-neutral-500">Hours between scheduled polls. 168 = weekly.</span>
                                        </label>
                                        <label className="block text-sm text-neutral-300">
                                            Candidate target count
                                            <input name="sourceConfig:icp:limit" type="number" min={10} max={5000} defaultValue={leadgenSettings.sourceConfig.icp?.limit ?? 1000} className="mt-2 h-10 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm text-white" />
                                            <span className="mt-1.5 block text-xs leading-5 text-neutral-500">Upper bound before staged qualification.</span>
                                        </label>
                                        <label className="block text-sm text-neutral-300">
                                            Max owner-evidence depth
                                            <input name="sourceConfig:icp:maxEnrichmentDepth" type="number" min={1} max={8} defaultValue={leadgenSettings.sourceConfig.icp?.maxEnrichmentDepth ?? 4} className="mt-2 h-10 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm text-white" />
                                            <span className="mt-1.5 block text-xs leading-5 text-neutral-500">How far the pipeline may chase owner evidence.</span>
                                        </label>
                                        <label className="flex min-h-11 items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-300">
                                            <input name="automaticPollsEnabled" type="checkbox" defaultChecked={Boolean(leadgenSettings.settings?.automatic_polls_enabled)} className="h-4 w-4 shrink-0 accent-white" />
                                            <span>Run polls automatically on this cadence</span>
                                        </label>
                                        <label className="flex min-h-11 items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-300">
                                            <input name="sourceConfig:icp:ownerRequired" type="checkbox" defaultChecked={leadgenSettings.sourceConfig.icp?.ownerRequired !== false} className="h-4 w-4 shrink-0 accent-white" />
                                            <span>Only show qualified leads when owner/principal and phone evidence is found</span>
                                        </label>
                                        <input type="hidden" name="geography" value={leadgenSettings.settings?.geography ?? ""} />
                                    </div>
                                    <SettingsSectionActions section="poll-options" label="poll automation" />
                                </div>
                            </UnifiedSection>

                            <UnifiedSection
                                id="leadgen-targeting"
                                title="Lead Gen Targeting"
                                description="Choose the ICP industries and locations used by the lead-generation pipeline."
                            >
                                <AdaptiveTargetingSettings
                                    industries={leadgenSettings.adaptiveIndustries}
                                    locations={leadgenSettings.adaptiveLocations}
                                    selectedIndustries={leadgenSettings.selectedIndustries}
                                    selectedLocations={leadgenSettings.selectedLocations}
                                />
                            </UnifiedSection>
                        </ManualSettingsForm>

                        <UnifiedSection
                            id="leadgen-sources"
                            title="Lead Gen Sources"
                            description="Control source categories, source-specific limits, mappings, and runtime readiness."
                        >
                            <ManualSettingsForm action={saveLeadgenSettings.bind(null, workspace.slug)}>
                                <input type="hidden" name="settingsScope" value="sources" />
                                <SourceSettingsCard
                                    sources={leadgenSettings.sourceItems}
                                    sourceCategoryIntents={leadgenSettings.sourceCategoryIntents}
                                    catalogueStats={leadgenSettings.catalogueStats}
                                />
                            </ManualSettingsForm>
                        </UnifiedSection>
                        <p className="pt-2 text-center text-xs text-neutral-600">Betelgeze © 2026</p>
                    </div>
                </div>
            </div>
        </main>
    )
}
