import { Suspense, type CSSProperties, type ReactNode } from "react"
import { WorkspaceIdentityEditor } from "@/components/admin/WorkspaceIdentityEditor"
import { PendingWorkspaceInvitations } from "@/components/admin/PendingWorkspaceInvitations"
import { WorkspaceInvitationForm } from "@/components/admin/WorkspaceInvitationForm"
import { WorkspaceConnections } from "@/components/admin/WorkspaceConnections"
import { WorkspaceOnboardingDomain } from "@/components/admin/WorkspaceOnboardingDomain"
import { WorkspaceTeamSettings } from "@/components/settings/WorkspaceTeamSettings"
import { AdaptiveTargetingSettings } from "@/components/leadgen/AdaptiveTargetingSettings"
import { ManualSettingsForm, SettingsSectionActions } from "@/components/leadgen/ManualSettingsForm"
import { SourceSettingsCard } from "@/components/leadgen/SourceSettingsCard"
import { SettingsSectionNav, type SettingsSectionNavItem } from "@/components/workspace/SettingsSectionNav"
import { AgencyBrandingEditor } from "@/components/settings/AgencyBrandingEditor"
import { AgencyPublicBrandingFields } from "@/components/settings/AgencyPublicBrandingFields"
import { OnboardingSettings } from "@/components/settings/OnboardingSettings"
import { ServiceCatalogue } from "@/components/settings/ServiceCatalogue"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { WorkspaceAutosaveForm } from "@/components/workspace/WorkspaceAutosaveForm"
import { WorkspaceActionButton } from "@/components/workspace/WorkspaceActionButton"
import { AdminMfaResetButton } from "@/components/admin/AdminMfaResetButton"
import { loadLeadgenSettingsPageData } from "@/lib/leadgen/settings-page-data"
import { createUploadSignedUrl } from "@/lib/onboarding/uploads"
import { loadOnboardingSettingsPageData } from "@/lib/onboarding/configuration"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { normalizeWorkspaceRole, requireWorkspace, workspaceRoleLabel } from "@/lib/workspaces"
import { loadWorkspaceTeams, loadWorkspaceMemberProfiles } from "@/lib/teams/server"
import { BASE_INTEGRATION_PROVIDERS, listWorkspaceConnections } from "@/lib/workspace-integrations"
import { loadWorkspacePublicBranding } from "@/lib/client-branding/public-branding"
import { loadWorkspaceClientBrandAssets } from "@/lib/client-branding/assets"
import { normalizeWorkspaceCapability, type WorkspaceCapability } from "@/lib/workspace-capabilities"
import { saveLeadgenSettings } from "../leadgen/settings/actions"
import { saveAgencyPublicBranding, uploadAgencyFavicon, uploadAgencyLogo } from "./branding-actions"
import { inviteWorkspaceUser, removeWorkspaceUser, resetWorkspaceUserMfa } from "../users/actions"
import {
    cancelWorkspaceClientPortalDomain,
    cancelWorkspaceOnboardingDomain,
    completeWhatsAppEmbeddedSignup,
    discardPendingWorkspaceConnection,
    disconnectWorkspaceConnection,
    removeWorkspaceInvitation,
    rollbackWorkspaceConnection,
    saveWorkspaceClientPortalDomain,
    saveWorkspaceConnection,
    saveWorkspaceOnboardingDomain,
    selectMetaAdsBusinessPortfolio,
    updateWorkspaceCoverLayout,
    updateWorkspaceName,
    uploadWorkspaceBanner,
    uploadWorkspaceLogo,
    verifyWorkspaceClientPortalDomain,
    verifyWorkspaceConnection,
    verifyWorkspaceOnboardingDomain,
    stageManualWorkspaceConnection,
    verifyPendingWorkspaceConnection,
} from "./actions"

export const dynamic = "force-dynamic"

const settingsSections = [
    { id: "workspace", label: "Workspace", detail: "Name and workspace details" },
    { id: "services", label: "Services", detail: "Catalogue and default pricing" },
    { id: "onboarding", label: "Onboarding", detail: "Domain and session builder" },
    { id: "client-portal", label: "Client Portal", detail: "Access, domain, and experience" },
    { id: "agency-branding", label: "Agency Branding", detail: "Public identity, policies, and style" },
    { id: "connections", label: "Connections", detail: "Providers and delivery channels" },
    { id: "users", label: "Users", detail: "Access and invitations" },
    { id: "teams", label: "Teams", detail: "People and responsibility routing" },
    { id: "leadgen", label: "Lead Gen", detail: "Automation, targeting, and sources" },
] satisfies SettingsSectionNavItem[]

type WorkspaceResult = Awaited<ReturnType<typeof requireWorkspace>>
type WorkspaceRecord = WorkspaceResult["workspace"]
type WorkspaceRole = WorkspaceResult["role"]
type OnboardingSettingsData = Awaited<ReturnType<typeof loadOnboardingSettingsPageData>>

function UnifiedSection({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
    return <section id={id} className="min-w-0 max-w-full scroll-mt-5">
        <div className="mb-4">
            <h2 className="text-xl font-semibold tracking-tight text-white">{title}</h2>
            <p className="mt-1 text-sm leading-6 text-neutral-400">{description}</p>
        </div>
        {children}
    </section>
}

function SettingsSectionFallback({ id, title, description, height = "min-h-40" }: { id: string; title: string; description: string; height?: string }) {
    return <UnifiedSection id={id} title={title} description={description}>
        <div aria-label={`Loading ${title} settings`} aria-busy="true" className={`${height} animate-pulse rounded-2xl border border-neutral-800 bg-neutral-900/70 p-5`}>
            <div className="h-4 w-40 max-w-full rounded bg-neutral-800" />
            <div className="mt-4 h-10 rounded-lg bg-neutral-950" />
            <div className="mt-3 h-10 w-2/3 rounded-lg bg-neutral-950" />
        </div>
    </UnifiedSection>
}

function IdentityFallback({ workspace }: { workspace: WorkspaceRecord }) {
    return <div aria-label="Loading workspace identity" aria-busy="true">
        <div className="relative mb-16 h-48 animate-pulse rounded-xl border border-neutral-800 bg-neutral-900 sm:h-[var(--workspace-cover-height)] sm:rounded-2xl" style={{ "--workspace-cover-height": `${workspace.banner_height}px` } as CSSProperties}>
            {workspace.logo_path ? <div className="absolute bottom-0 left-4 h-[112px] w-[112px] translate-y-1/2 rounded-full border-4 border-neutral-950 bg-neutral-900 sm:left-7 sm:h-[108px] sm:w-[108px]" /> : null}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
    </div>
}

async function SettingsIdentity({ workspace }: { workspace: WorkspaceRecord }) {
    const [bannerSrc, logoSrc] = await Promise.all([
        workspace.banner_path ? createUploadSignedUrl(workspace.banner_path) : null,
        workspace.logo_path ? createUploadSignedUrl(workspace.logo_path) : null,
    ])
    return <WorkspaceIdentityEditor
        workspace={{ name: workspace.name, slug: workspace.slug, bannerHeight: workspace.banner_height, bannerPosition: workspace.banner_position, bannerSrc, logoSrc }}
        updateName={updateWorkspaceName.bind(null, workspace.slug)}
        updateCoverLayout={updateWorkspaceCoverLayout.bind(null, workspace.slug)}
        uploadBanner={uploadWorkspaceBanner.bind(null, workspace.slug)}
        uploadLogo={uploadWorkspaceLogo.bind(null, workspace.slug)}
        description={null}
        bannerLabel="workspace banner"
        displayName="Settings"
        showNameEditor={false}
    />
}

function WorkspaceSettingsSection({ workspace }: { workspace: WorkspaceRecord }) {
    return <UnifiedSection id="workspace" title="Workspace" description="Edit the workspace name shown in the top bar, menus, and account areas.">
        <WorkspaceAutosaveForm action={updateWorkspaceName.bind(null, workspace.slug)} className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 sm:p-5">
            <label className="block text-sm text-neutral-300">Workspace name<input name="name" required defaultValue={workspace.name} className="mt-2 h-11 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm text-white" /></label>
        </WorkspaceAutosaveForm>
    </UnifiedSection>
}

async function ServicesSettingsSection({ workspace, initialServiceId, onboardingSettingsPromise }: { workspace: WorkspaceRecord; initialServiceId?: string; onboardingSettingsPromise: Promise<OnboardingSettingsData> }) {
    const [onboardingSettings, serviceCapabilitiesResult] = await Promise.all([
        onboardingSettingsPromise,
        supabaseAdmin.from("workspace_service_capabilities").select("service_id, capability").eq("workspace_id", workspace.id),
    ])
    const capabilitiesByService = new Map<string, WorkspaceCapability[]>()
    for (const grant of serviceCapabilitiesResult.data ?? []) {
        const capability = normalizeWorkspaceCapability(grant.capability)
        if (capability) capabilitiesByService.set(grant.service_id, [...(capabilitiesByService.get(grant.service_id) ?? []), capability])
    }
    return <section id="services" className="min-w-0 max-w-full scroll-mt-5">
        <ServiceCatalogue workspaceSlug={workspace.slug} services={onboardingSettings.services} modules={onboardingSettings.modules} assignees={onboardingSettings.assignees} schemaReady={onboardingSettings.schemaReady} initialServiceId={initialServiceId} serviceCapabilities={Object.fromEntries(capabilitiesByService)} />
    </section>
}

async function OnboardingSettingsSection({ workspace, role, onboardingSettingsPromise }: { workspace: WorkspaceRecord; role: WorkspaceRole; onboardingSettingsPromise: Promise<OnboardingSettingsData> }) {
    const onboardingSettings = await onboardingSettingsPromise
    return <UnifiedSection id="onboarding" title="Onboarding" description="Compose mandatory modules, manage client help, open Builder, and control the domain used for onboarding sessions.">
        <OnboardingSettings workspaceSlug={workspace.slug} modules={onboardingSettings.modules} mandatory={onboardingSettings.mandatory} welcome={onboardingSettings.welcome} completion={onboardingSettings.completion} help={onboardingSettings.help} schemaReady={onboardingSettings.schemaReady} />
        <div id="onboarding-domain" className="scroll-mt-5"><WorkspaceOnboardingDomain domain={workspace.custom_onboarding_domain} status={workspace.custom_onboarding_domain_status} records={workspace.custom_onboarding_domain_records} error={workspace.custom_onboarding_domain_error} saveAction={saveWorkspaceOnboardingDomain.bind(null, workspace.slug)} verifyAction={verifyWorkspaceOnboardingDomain.bind(null, workspace.slug)} cancelAction={cancelWorkspaceOnboardingDomain.bind(null, workspace.slug)} canManage={role === "owner" || role === "admin"} /></div>
    </UnifiedSection>
}

function ClientPortalSettingsSection({ workspace, role }: { workspace: WorkspaceRecord; role: WorkspaceRole }) {
    return <UnifiedSection id="client-portal" title="Client Portal" description="Control the domain and settings used for the post-onboarding client experience.">
        <div id="client-portal-domain" className="scroll-mt-5"><WorkspaceOnboardingDomain surface="client_portal" domain={workspace.custom_client_portal_domain} status={workspace.custom_client_portal_domain_status} records={workspace.custom_client_portal_domain_records} error={workspace.custom_client_portal_domain_error} saveAction={saveWorkspaceClientPortalDomain.bind(null, workspace.slug)} verifyAction={verifyWorkspaceClientPortalDomain.bind(null, workspace.slug)} cancelAction={cancelWorkspaceClientPortalDomain.bind(null, workspace.slug)} canManage={role === "owner" || role === "admin"} /></div>
    </UnifiedSection>
}

async function AgencyBrandingSettingsSection({ workspace, onboardingSettingsPromise }: { workspace: WorkspaceRecord; onboardingSettingsPromise: Promise<OnboardingSettingsData> }) {
    const [onboardingSettings, publicBranding, clientBrandAssets] = await Promise.all([
        onboardingSettingsPromise,
        loadWorkspacePublicBranding(workspace.id, workspace.name),
        loadWorkspaceClientBrandAssets(workspace.id),
    ])
    const [agencyLogoSrc, agencyFaviconSrc] = await Promise.all([
        clientBrandAssets.logoPath ? createUploadSignedUrl(clientBrandAssets.logoPath) : null,
        clientBrandAssets.faviconPath ? createUploadSignedUrl(clientBrandAssets.faviconPath) : null,
    ])
    return <UnifiedSection id="agency-branding" title="Agency Branding" description="Manage the public identity, policies, metadata, favicon, and colours used across agency-branded pages.">
        <div className="space-y-5">
            <AgencyPublicBrandingFields branding={publicBranding} saveAction={saveAgencyPublicBranding.bind(null, workspace.slug)} />
            <AgencyBrandingEditor workspaceSlug={workspace.slug} workspaceName={publicBranding.displayName} initialTheme={onboardingSettings.theme} publishedTheme={onboardingSettings.publishedTheme} previewBookend={onboardingSettings.welcome} help={onboardingSettings.help} schemaReady={onboardingSettings.schemaReady} brandAssetSchemaReady={clientBrandAssets.schemaReady} logoSrc={agencyLogoSrc} faviconSrc={agencyFaviconSrc} uploadLogo={uploadAgencyLogo.bind(null, workspace.slug)} uploadFavicon={uploadAgencyFavicon.bind(null, workspace.slug)} />
        </div>
    </UnifiedSection>
}

async function ConnectionsSettingsSection({ workspace, isOwner }: { workspace: WorkspaceRecord; isOwner: boolean }) {
    const integrationResult = await listWorkspaceConnections(workspace.id)
    const connections = [...BASE_INTEGRATION_PROVIDERS.map((provider) => integrationResult.find((item) => item.provider === provider) ?? { provider, enabled: false, mode: "disabled", config_hint: {} }), ...integrationResult.filter((item) => item.provider === "meta_ads")] as Parameters<typeof WorkspaceConnections>[0]["connections"]
    return <UnifiedSection id="connections" title="Connections" description="Manage active provider credentials and client communication delivery channels.">
        <WorkspaceConnections workspaceSlug={workspace.slug} connections={connections} action={saveWorkspaceConnection.bind(null, workspace.slug)} verifyAction={verifyWorkspaceConnection.bind(null, workspace.slug)} manualAction={stageManualWorkspaceConnection.bind(null, workspace.slug)} completeWhatsAppAction={completeWhatsAppEmbeddedSignup.bind(null, workspace.slug)} selectMetaAdsBusinessAction={selectMetaAdsBusinessPortfolio.bind(null, workspace.slug)} verifyPendingAction={verifyPendingWorkspaceConnection.bind(null, workspace.slug)} discardPendingAction={discardPendingWorkspaceConnection.bind(null, workspace.slug)} rollbackAction={rollbackWorkspaceConnection.bind(null, workspace.slug)} disconnectAction={disconnectWorkspaceConnection.bind(null, workspace.slug)} canManage={isOwner} metaAppId={process.env.NEXT_PUBLIC_META_APP_ID ?? null} metaEmbeddedSignupConfigId={process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID ?? null} showHeader={false} />
    </UnifiedSection>
}

function serviceOptions(settings: OnboardingSettingsData) {
    return settings.services.filter((service) => /^[0-9a-f-]{36}$/i.test(service.id)).map((service) => ({ id: service.id, name: service.name, state: service.state }))
}

async function UsersSettingsSection({ workspace, isOwner, onboardingSettingsPromise }: { workspace: WorkspaceRecord; isOwner: boolean; onboardingSettingsPromise: Promise<OnboardingSettingsData> }) {
    const [membershipsResult, onboardingSettings] = await Promise.all([
        supabaseAdmin.from("workspace_memberships").select("user_id, role, created_at").eq("workspace_id", workspace.id).order("created_at"),
        onboardingSettingsPromise,
    ])
    const users = await Promise.all((membershipsResult.data ?? []).map(async (membership) => ({ ...membership, user: (await supabaseAdmin.auth.admin.getUserById(membership.user_id)).data.user })))
    const services = serviceOptions(onboardingSettings)
    return <UnifiedSection id="users" title="Users" description="Invite teammates and control workspace access.">
        <WorkspaceInvitationForm workspaceSlug={workspace.slug} action={inviteWorkspaceUser.bind(null, workspace.slug)} canInviteAdmins={isOwner} services={services.filter((service) => service.state === "active")} />
        <div className="mt-5 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900">
            <PendingWorkspaceInvitations workspaceId={workspace.id} removeAction={removeWorkspaceInvitation.bind(null, workspace.slug)} services={services} />
            {users.map(({ user: workspaceUser, role: assignedRole }) => <div key={workspaceUser?.id} className="flex flex-col gap-3 border-b border-neutral-800 p-4 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div><p className="break-words font-medium">{workspaceUser?.email}</p><p className="text-sm text-neutral-500">{workspaceRoleLabel(assignedRole)}</p></div>
                {normalizeWorkspaceRole(assignedRole) !== "owner" ? <div className="flex flex-wrap items-center gap-2">
                    {(isOwner || normalizeWorkspaceRole(assignedRole) === "staff") ? <AdminMfaResetButton email={workspaceUser?.email ?? "this user"} userId={workspaceUser?.id ?? ""} action={resetWorkspaceUserMfa.bind(null, workspace.slug)} /> : null}
                    <form action={removeWorkspaceUser.bind(null, workspace.slug)} data-workspace-mutation="background" className="flex-1 sm:flex-none"><input type="hidden" name="userId" value={workspaceUser?.id} /><WorkspaceActionButton pendingLabel="Removing…" confirmMessage={`Remove ${workspaceUser?.email ?? "this user"} from the workspace?`} className="w-full rounded-lg border border-red-900 px-3 py-1 text-sm text-red-300 sm:w-auto">Remove</WorkspaceActionButton></form>
                </div> : null}
            </div>)}
        </div>
    </UnifiedSection>
}

async function TeamsSettingsSection({ workspace, isOwner }: { workspace: WorkspaceRecord; isOwner: boolean }) {
    const [teamResult, teamPeople, teamConversationResult] = await Promise.all([
        loadWorkspaceTeams(workspace.id),
        loadWorkspaceMemberProfiles(workspace.id),
        supabaseAdmin.from("workspace_native_conversations").select("id, team_id").eq("workspace_id", workspace.id).eq("kind", "team"),
    ])
    const conversationIds = Object.fromEntries((teamConversationResult.data ?? []).flatMap((conversation) => conversation.team_id ? [[conversation.team_id, conversation.id]] : []))
    return <UnifiedSection id="teams" title="Teams" description="Review required teams, maintenance responsibility, and fulfilment collaboration."><WorkspaceTeamSettings workspaceSlug={workspace.slug} teams={teamResult.teams} people={teamPeople} conversationIds={conversationIds} ownerCanEditMaintenance={isOwner} /></UnifiedSection>
}

async function LeadgenSettingsSection({ workspace }: { workspace: WorkspaceRecord }) {
    const leadgenSettings = await loadLeadgenSettingsPageData(workspace.id)
    return <UnifiedSection id="leadgen" title="Lead Gen" description="Manage poll automation, ICP targeting, source readiness, mappings, and runtime controls.">
        <ManualSettingsForm action={saveLeadgenSettings.bind(null, workspace.slug)} className="space-y-6">
            <div id="leadgen-automation" className="scroll-mt-5"><div data-settings-section="poll-options" className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 sm:p-5">
                <input type="hidden" name="settingsScope" value="settings" />
                <h3 className="text-lg font-semibold leading-6">Poll Automation</h3>
                <p className="mt-1.5 text-sm leading-5 text-neutral-400">Cadence, run limits, and automated polling defaults.</p>
                <div className="mt-4 grid gap-3">
                    <label className="block text-sm text-neutral-300">Automatic poll interval<input name="pollIntervalHours" type="number" min={1} max={2160} defaultValue={leadgenSettings.settings?.poll_interval_hours ?? 168} className="mt-2 h-10 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm text-white" /><span className="mt-1.5 block text-xs leading-5 text-neutral-500">Hours between scheduled polls. 168 = weekly.</span></label>
                    <label className="block text-sm text-neutral-300">Candidate target count<input name="sourceConfig:icp:limit" type="number" min={10} max={5000} defaultValue={leadgenSettings.sourceConfig.icp?.limit ?? 1000} className="mt-2 h-10 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm text-white" /><span className="mt-1.5 block text-xs leading-5 text-neutral-500">Upper bound before staged qualification.</span></label>
                    <label className="block text-sm text-neutral-300">Max owner-evidence depth<input name="sourceConfig:icp:maxEnrichmentDepth" type="number" min={1} max={8} defaultValue={leadgenSettings.sourceConfig.icp?.maxEnrichmentDepth ?? 4} className="mt-2 h-10 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm text-white" /><span className="mt-1.5 block text-xs leading-5 text-neutral-500">How far the pipeline may chase owner evidence.</span></label>
                    <label className="flex min-h-11 items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-300"><input name="automaticPollsEnabled" type="checkbox" defaultChecked={Boolean(leadgenSettings.settings?.automatic_polls_enabled)} className="h-4 w-4 shrink-0 accent-white" /><span>Run polls automatically on this cadence</span></label>
                    <label className="flex min-h-11 items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-300"><input name="sourceConfig:icp:ownerRequired" type="checkbox" defaultChecked={leadgenSettings.sourceConfig.icp?.ownerRequired !== false} className="h-4 w-4 shrink-0 accent-white" /><span>Only show qualified leads when owner/principal and phone evidence is found</span></label>
                    <input type="hidden" name="geography" value={leadgenSettings.settings?.geography ?? ""} />
                </div>
                <SettingsSectionActions section="poll-options" label="poll automation" />
            </div></div>
            <div id="leadgen-targeting" className="scroll-mt-5"><AdaptiveTargetingSettings industries={leadgenSettings.adaptiveIndustries} locations={leadgenSettings.adaptiveLocations} selectedIndustries={leadgenSettings.selectedIndustries} selectedLocations={leadgenSettings.selectedLocations} /></div>
        </ManualSettingsForm>
        <div id="leadgen-sources" className="mt-6 scroll-mt-5"><ManualSettingsForm action={saveLeadgenSettings.bind(null, workspace.slug)}><input type="hidden" name="settingsScope" value="sources" /><SourceSettingsCard sources={leadgenSettings.sourceItems} sourceCategoryIntents={leadgenSettings.sourceCategoryIntents} catalogueStats={leadgenSettings.catalogueStats} /></ManualSettingsForm></div>
    </UnifiedSection>
}

type PageProps = { params: Promise<{ workspaceSlug: string }>; searchParams: Promise<{ service?: string }> }

export default async function SettingsPage({ params, searchParams }: PageProps) {
    const [{ workspaceSlug }, query] = await Promise.all([params, searchParams])
    const { workspace, role, user } = await requireWorkspace(workspaceSlug, "admin")
    const isOwner = role === "owner"
    const onboardingSettingsPromise = loadOnboardingSettingsPageData(workspace.id)

    return <main className="min-h-screen max-w-full overflow-x-clip bg-neutral-950 px-4 pb-8 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
        <div className="mx-auto min-w-0 max-w-7xl pt-5">
            <Suspense fallback={<IdentityFallback workspace={workspace} />}><SettingsIdentity workspace={workspace} /></Suspense>
            <div className="mt-8 grid min-w-0 max-w-full gap-8 lg:grid-cols-[16rem_minmax(0,1fr)]">
                <SettingsSectionNav sections={settingsSections} />
                <div id="workspace-settings-scroll" className="min-w-0 max-w-full space-y-10 pb-8 lg:pr-2">
                    <WorkspaceSettingsSection workspace={workspace} />
                    <Suspense fallback={<SettingsSectionFallback id="services" title="Services" description="Catalogue and default pricing for client work." height="min-h-72" />}><ServicesSettingsSection workspace={workspace} initialServiceId={query.service} onboardingSettingsPromise={onboardingSettingsPromise} /></Suspense>
                    <Suspense fallback={<SettingsSectionFallback id="onboarding" title="Onboarding" description="Compose mandatory modules, manage client help, open Builder, and control the domain used for onboarding sessions." height="min-h-72" />}><OnboardingSettingsSection workspace={workspace} role={role} onboardingSettingsPromise={onboardingSettingsPromise} /></Suspense>
                    <ClientPortalSettingsSection workspace={workspace} role={role} />
                    <Suspense fallback={<SettingsSectionFallback id="agency-branding" title="Agency Branding" description="Manage the public identity, policies, metadata, favicon, and colours used across agency-branded pages." height="min-h-72" />}><AgencyBrandingSettingsSection workspace={workspace} onboardingSettingsPromise={onboardingSettingsPromise} /></Suspense>
                    <Suspense fallback={<SettingsSectionFallback id="connections" title="Connections" description="Manage active provider credentials and client communication delivery channels." height="min-h-64" />}><ConnectionsSettingsSection workspace={workspace} isOwner={isOwner} /></Suspense>
                    <Suspense fallback={<SettingsSectionFallback id="users" title="Users" description="Invite teammates and control workspace access." height="min-h-56" />}><UsersSettingsSection workspace={workspace} isOwner={isOwner} onboardingSettingsPromise={onboardingSettingsPromise} /></Suspense>
                    <Suspense fallback={<SettingsSectionFallback id="teams" title="Teams" description="Review required teams, maintenance responsibility, and fulfilment collaboration." height="min-h-56" />}><TeamsSettingsSection workspace={workspace} isOwner={isOwner} /></Suspense>
                    <Suspense fallback={<SettingsSectionFallback id="leadgen" title="Lead Gen" description="Manage poll automation, ICP targeting, source readiness, mappings, and runtime controls." height="min-h-80" />}><LeadgenSettingsSection workspace={workspace} /></Suspense>
                    <p className="pt-2 text-center text-xs text-neutral-600">Betelgeze © 2026</p>
                </div>
            </div>
        </div>
    </main>
}
