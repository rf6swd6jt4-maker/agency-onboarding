import Link from "next/link"
import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { ListActionMenu } from "@/components/list/ListActionMenu"
import { MobileListActionSurface } from "@/components/list/MobileCardActionSurface"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { RelationshipStage, SquarePill, Status } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { filterAppointmentSettingRelationships } from "@/lib/appointment-setting"
import { listRelationshipsForWorkspace, relationshipHubHref, relationshipLocationLabel } from "@/lib/relationships"
import { accessibleRelationshipIds, requireWorkspacePanel } from "@/lib/workspace-access"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"

export const dynamic = "force-dynamic"

function displayPhone(value: string | null | undefined) {
    return value?.replace(/^(?:sms|whatsapp):/i, "") ?? null
}

export default async function AppointmentSettingPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await params
    const { workspace, user, role, access } = await requireWorkspacePanel(workspaceSlug, "appointment-setting")
    const [relationships, allowedRelationshipIds] = await Promise.all([
        listRelationshipsForWorkspace(workspace.id),
        accessibleRelationshipIds(access),
    ])
    const eligibleRelationships = filterAppointmentSettingRelationships(relationships, allowedRelationshipIds)

    return <main className="min-h-screen bg-neutral-950 px-4 pb-7 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} workspaceAccess={access} currentProduct="client-work" />
        <div className="mx-auto max-w-7xl pt-5">
            <WorkspaceBanner bannerPath={workspace.banner_path} logoPath={workspace.logo_path} name={workspace.name} height={workspace.banner_height} position={workspace.banner_position} />
            <PanelTabHeader title="Appointment Setting" description="Retention relationships eligible to begin appointment setting." />

            <List ariaLabel="Relationships ready for appointment setting">
                {eligibleRelationships.length ? eligibleRelationships.map((relationship) => {
                    const relationshipTitle = relationship.business_name
                        ? `${relationship.primary_person_name} – ${relationship.business_name}`
                        : relationship.primary_person_name
                    const location = relationshipLocationLabel(relationship)
                    const phone = displayPhone(relationship.whatsapp_phone ?? relationship.primary_phone)
                    const isTest = Boolean(relationship.source_metadata.is_test)
                    const relationshipHref = role === "staff" ? null : relationshipHubHref(workspace.slug, relationship.id)
                    const actions = relationshipHref ? [{ label: "Open relationship", href: relationshipHref }] : []
                    const rows = <>
                        <ListPrimaryRow>
                            <ListTitle href={relationshipHref} className="flex-1">{relationshipTitle}</ListTitle>
                            {isTest ? <SquarePill tone="yellow" className="shrink-0">Test</SquarePill> : null}
                            <RelationshipStage phase="retention" className="shrink-0" />
                            <Status label="Ready" tone="green" className="ml-auto shrink-0" />
                        </ListPrimaryRow>
                        <ListSecondaryRow>
                            {relationship.primary_contact_role ? <span className="hidden shrink-0 text-neutral-400 lg:inline">{relationship.primary_contact_role}</span> : null}
                            {phone ? <span className="hidden min-w-0 truncate text-neutral-200 sm:inline">{phone}</span> : null}
                            <span className="hidden min-w-0 truncate text-neutral-400 md:inline">{relationship.primary_email ?? "No email saved"}</span>
                            <span className="hidden min-w-0 truncate capitalize text-neutral-500 lg:inline">{location ?? "Location unset"}</span>
                            <ListTrailing>
                                <span className="font-mono text-neutral-500">{shortId(relationship.id)}</span>
                                <span className="whitespace-nowrap text-neutral-500">{formatRelativeTime(relationship.updated_at)}</span>
                                {relationshipHref ? <ListActionMenu actions={actions} className="hidden sm:block" /> : null}
                            </ListTrailing>
                        </ListSecondaryRow>
                    </>
                    return <ListItem key={relationship.id}>
                        {relationshipHref
                            ? <MobileListActionSurface actions={actions} label={`Open actions for ${relationshipTitle}`}>{rows}</MobileListActionSurface>
                            : rows}
                    </ListItem>
                }) : <div className="p-6">
                    <p className="text-lg font-semibold">No relationships ready for appointment setting.</p>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">
                        Relationships appear here after fulfilment is complete and they enter Retention.
                        {role === "staff" ? null : <> <Link href={`/${workspace.slug}/relationships?phase=retention`} className="text-neutral-200 underline decoration-neutral-600 underline-offset-4 hover:text-white">View Retention relationships</Link>.</>}
                    </p>
                </div>}
            </List>
        </div>
    </main>
}
