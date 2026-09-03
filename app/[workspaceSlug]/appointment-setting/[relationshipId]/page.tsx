import { notFound } from "next/navigation"
import { AppointmentTable } from "@/components/appointment-setting/AppointmentTable"
import { DetailPageHeader } from "@/components/detail"
import { RelationshipStage, SquarePill } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { ClientContextPanel } from "@/components/workspace/ClientContextPanel"
import { loadAppointmentSettingConfiguration, loadAppointmentSettingRelationshipService, listAppointmentSettingAppointments } from "@/lib/appointment-setting-server"
import { getRelationship } from "@/lib/relationships"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspacePanel } from "@/lib/workspace-access"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string; relationshipId: string }>
}

export default async function AppointmentSettingRelationshipPage({ params }: PageProps) {
    const { workspaceSlug, relationshipId } = await params
    const { workspace, user, role, access } = await requireWorkspacePanel(workspaceSlug, "appointment-setting")
    const [relationship, serviceId] = await Promise.all([
        getRelationship(workspace.id, relationshipId),
        loadAppointmentSettingRelationshipService(access, relationshipId),
    ])
    if (
        !relationship
        || !serviceId
        || relationship.status === "archived"
        || relationship.lifecycle_phase !== "retention"
    ) notFound()

    const [appointments, configuration] = await Promise.all([
        listAppointmentSettingAppointments({ workspaceId: workspace.id, relationshipId: relationship.id, serviceId }),
        loadAppointmentSettingConfiguration({ workspaceId: workspace.id, relationshipId: relationship.id, serviceId }),
    ])
    const uniquePhoneCount = new Set(appointments.map((appointment) => appointment.phone).filter(Boolean)).size
    const latestUpdatedAt = appointments.reduce((latest, appointment) => (
        appointment.updated_at > latest ? appointment.updated_at : latest
    ), relationship.updated_at)

    return <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} workspaceAccess={access} currentProduct="client-work" />
        <div className="mx-auto max-w-[92rem]">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                    <DetailPageHeader
                        category="Appointment Setting"
                        reference={shortId(relationship.id)}
                        title={relationship.primary_person_name}
                        subtitle={relationship.business_name ?? "No company saved"}
                        labels={<>{relationship.source_metadata.is_test === true ? <SquarePill tone="yellow">Test</SquarePill> : null}<RelationshipStage phase="retention" /></>}
                        facts={[
                            { label: "appointments", value: appointments.length },
                            { label: "contacts", value: uniquePhoneCount },
                        ]}
                        updated={formatRelativeTime(latestUpdatedAt)}
                    />

                    <AppointmentTable
                        key={relationship.id}
                        workspaceId={workspace.id}
                        workspaceSlug={workspace.slug}
                        relationshipId={relationship.id}
                        serviceId={serviceId}
                        initialAppointments={appointments}
                        configuration={configuration}
                    />
                </div>

                <ClientContextPanel
                    workspaceSlug={workspace.slug}
                    relationship={relationship}
                    metrics={[
                        { label: "Appointments", value: appointments.length },
                        { label: "Contacts", value: uniquePhoneCount },
                    ]}
                    allowedDestinations={role === "staff" ? ["onboarding", "fulfilment"] : undefined}
                />
            </div>
        </div>
    </main>
}
