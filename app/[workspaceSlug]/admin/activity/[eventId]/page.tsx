import Link from "next/link"
import { notFound } from "next/navigation"

import { AdminPanelNav } from "@/components/admin/AdminPanelNav"
import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { Assignee, SquarePill, Status, type StatusTone } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { adminActivityCategoryLabel, getAdminActivityEvent, listCorrelatedAdminActivity, type AdminActivityLevel } from "@/lib/admin/activity"
import { profileAvatarUrl } from "@/lib/profile-avatar"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ workspaceSlug: string; eventId: string }> }

function eventStatus(level: AdminActivityLevel): { label: string; tone: StatusTone } {
    if (level === "error") return { label: "Error", tone: "red" }
    if (level === "warning") return { label: "Warning", tone: "yellow" }
    return { label: "Info", tone: "grey" }
}

function readableKey(value: string) {
    return value.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase())
}

function readableValue(value: unknown) {
    if (value === null || value === undefined || value === "") return "—"
    if (typeof value === "object") return JSON.stringify(value, null, 2)
    return String(value)
}

function DetailGrid({ values }: { values: Array<{ label: string; value: unknown; mono?: boolean }> }) {
    return <dl className="grid gap-px overflow-hidden rounded-xl border border-neutral-800 bg-neutral-800 sm:grid-cols-2">
        {values.map((item) => <div key={item.label} className="min-w-0 bg-black px-4 py-3">
            <dt className="text-xs font-medium uppercase tracking-wide text-neutral-600">{item.label}</dt>
            <dd className={`mt-1 break-words text-sm text-neutral-200 ${item.mono ? "font-mono" : ""}`}>{readableValue(item.value)}</dd>
        </div>)}
    </dl>
}

export default async function AdminActivityDetailPage({ params }: PageProps) {
    const { workspaceSlug, eventId } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    const event = await getAdminActivityEvent(workspace.id, eventId)
    if (!event) notFound()
    const timeline = event.correlation_id ? await listCorrelatedAdminActivity(workspace.id, event.correlation_id) : [event]
    const { data: actorProfile } = event.actor_user_id
        ? await supabaseAdmin.from("user_profiles").select("username, avatar_path").eq("user_id", event.actor_user_id).maybeSingle()
        : { data: null }
    const actorName = actorProfile?.username ?? (event.actor_kind === "client" ? "Client" : event.actor_kind === "automation" || !event.actor_user_id ? "Betelgeze automation" : "Workspace user")
    const actorAvatar = actorProfile?.avatar_path ? profileAvatarUrl(actorName, actorProfile.avatar_path) : null
    const status = eventStatus(event.level)
    const metadata = event.metadata ?? {}
    const diagnostics = event.diagnostics ?? {}
    const relationshipId = typeof metadata.relationship_id === "string" ? metadata.relationship_id : null
    const sessionId = typeof metadata.session_id === "string" ? metadata.session_id : event.entity_type === "onboarding_session" ? event.entity_id : null
    const moduleId = typeof metadata.module_id === "string" ? metadata.module_id : event.entity_type === "onboarding_module" ? event.entity_id : null
    const serviceId = typeof metadata.service_id === "string" ? metadata.service_id : event.entity_type === "onboarding_service" ? event.entity_id : null
    const metadataEntries = Object.entries(metadata)
    const diagnosticEntries = Object.entries(diagnostics)
    const errorCode = diagnostics.error_code ?? metadata.error_code
    const automationStage = diagnostics.automation_stage ?? metadata.automation_stage ?? metadata.stage
    const providerSummary = diagnostics.provider_response_summary ?? metadata.provider_response_summary

    return <main className="min-h-screen bg-neutral-950 px-4 pb-8 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
        <div className="mx-auto max-w-7xl pt-5">
            <WorkspaceBanner bannerPath={workspace.banner_path} logoPath={workspace.logo_path} name={workspace.name} height={workspace.banner_height} position={workspace.banner_position} />
            <PanelTabHeader
                title="Activity event"
                description="Permanent audit and diagnostic record, including its correlated operation timeline."
                tabs={<AdminPanelNav workspaceSlug={workspace.slug} active="activity" />}
                actions={<Link href={`/${workspace.slug}/admin/activity`} className="rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-300 hover:border-neutral-500 hover:text-white">Back to Activity</Link>}
            />

            <section className="mt-5 rounded-2xl border border-neutral-800 bg-black p-5">
                <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                        <p className="font-mono text-xs text-neutral-600">{event.event_key}</p>
                        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{event.summary}</h1>
                    </div>
                    <SquarePill>{adminActivityCategoryLabel(event.category)}</SquarePill>
                    <Status label={status.label} tone={status.tone} />
                </div>
                <div className="mt-5"><DetailGrid values={[
                    { label: "Event ID", value: event.id, mono: true },
                    { label: "Occurred", value: new Date(event.occurred_at).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "medium", timeZone: "Europe/Dublin" }) },
                    { label: "Actor kind", value: event.actor_kind ?? (event.actor_user_id ? "staff" : "automation") },
                    { label: "Outcome", value: event.outcome ?? (event.level === "error" ? "failed" : "succeeded") },
                    { label: "Correlation ID", value: event.correlation_id, mono: true },
                    { label: "Causation event ID", value: event.causation_event_id, mono: true },
                    { label: "Entity", value: event.entity_id ? `${event.entity_type ?? "record"} ${event.entity_id}` : null, mono: true },
                    { label: "Metric classification", value: event.metric_classification ?? "audit" },
                ]} /></div>
                <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
                    <Assignee name={actorName} avatarSrc={actorAvatar} compact />
                    {event.source_href ? <Link href={event.source_href} className="text-sky-300 hover:text-sky-200">Open source</Link> : null}
                    {event.maintenance_work_item_id ? <Link href={`/${workspace.slug}/work-items/${event.maintenance_work_item_id}`} className="text-sky-300 hover:text-sky-200">Open Maintenance work</Link> : null}
                    {relationshipId ? <Link href={`/${workspace.slug}/relationships/${relationshipId}`} className="text-sky-300 hover:text-sky-200">Open relationship</Link> : null}
                    {sessionId && relationshipId ? <Link href={`/${workspace.slug}/onboarding/${relationshipId}`} className="text-sky-300 hover:text-sky-200">Open onboarding session</Link> : null}
                    {moduleId ? <Link href={`/${workspace.slug}/onboarding-builder?module=${moduleId}`} className="text-sky-300 hover:text-sky-200">Open module</Link> : null}
                    {serviceId ? <Link href={`/${workspace.slug}/settings?section=services&service=${serviceId}`} className="text-sky-300 hover:text-sky-200">Open service</Link> : null}
                </div>
            </section>

            <div className="mt-5 grid gap-5 lg:grid-cols-2">
                <section className="rounded-2xl border border-neutral-800 bg-black p-5">
                    <h2 className="text-lg font-semibold">Changed fields and references</h2>
                    {metadataEntries.length ? <dl className="mt-4 divide-y divide-neutral-900 rounded-xl border border-neutral-900">
                        {metadataEntries.map(([key, value]) => <div key={key} className="grid gap-1 px-3 py-3 sm:grid-cols-[180px_minmax(0,1fr)]"><dt className="text-sm text-neutral-500">{readableKey(key)}</dt><dd className="break-words whitespace-pre-wrap font-mono text-xs leading-5 text-neutral-300">{readableValue(value)}</dd></div>)}
                    </dl> : <p className="mt-3 text-sm text-neutral-500">No changed-field metadata was recorded.</p>}
                </section>
                <section className="rounded-2xl border border-neutral-800 bg-black p-5">
                    <h2 className="text-lg font-semibold">Sanitized diagnostics</h2>
                    <div className="mt-4"><DetailGrid values={[
                        { label: "Error code", value: errorCode, mono: true },
                        { label: "Failure fingerprint", value: event.failure_fingerprint, mono: true },
                        { label: "Automation stage", value: automationStage },
                        { label: "Provider response", value: providerSummary },
                    ]} /></div>
                    {diagnosticEntries.length ? <pre className="mt-4 max-h-96 overflow-auto rounded-xl border border-neutral-900 bg-neutral-950 p-4 text-xs leading-5 text-neutral-300">{JSON.stringify(diagnostics, null, 2)}</pre> : <p className="mt-3 text-sm text-neutral-500">No diagnostic payload was recorded.</p>}
                </section>
            </div>

            <List ariaLabel="Correlated activity timeline">
                {timeline.map((item) => {
                    const itemStatus = eventStatus(item.level)
                    return <ListItem key={item.id} className={item.id === event.id ? "bg-sky-950/[0.12]" : ""}>
                        <ListPrimaryRow>
                            <ListTitle href={`/${workspace.slug}/admin/activity/${item.id}`} className="flex-1">{item.summary}</ListTitle>
                            <SquarePill>{adminActivityCategoryLabel(item.category)}</SquarePill>
                            <Status label={itemStatus.label} tone={itemStatus.tone} />
                        </ListPrimaryRow>
                        <ListSecondaryRow>
                            <span className="min-w-0 flex-1 truncate font-mono text-xs text-neutral-500">{item.event_key}</span>
                            <ListTrailing><span className="font-mono text-neutral-600">{shortId(item.id)}</span><span className="text-neutral-500">{formatRelativeTime(item.occurred_at)}</span></ListTrailing>
                        </ListSecondaryRow>
                    </ListItem>
                })}
            </List>
        </div>
    </main>
}
