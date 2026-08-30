import { notFound } from "next/navigation"
import { DetailField, DetailFields, DetailPageHeader } from "@/components/detail"
import { ServiceEditor } from "@/components/settings/ServiceCatalogue"
import { SquarePill, Status } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { loadOnboardingSettingsPageData } from "@/lib/onboarding/configuration"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string; serviceId: string }>
}

export default async function ServiceEditPage({ params }: PageProps) {
    const { workspaceSlug, serviceId } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    const configuration = await loadOnboardingSettingsPageData(workspace.id)
    const service = configuration.services.find((candidate) => candidate.id === serviceId)
    if (!service) notFound()
    const status = service.state === "active"
        ? { label: "Active", tone: "green" as const }
        : service.state === "retired"
            ? { label: "Retired", tone: "yellow" as const }
            : { label: "Archived", tone: "grey" as const }

    return <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
        <div className="mx-auto max-w-4xl">
            <DetailPageHeader
                category="Service"
                reference={shortId(service.id)}
                title={service.name}
                subtitle={`Revision ${service.version} · ${service.code}`}
                labels={<>{service.serviceType === "retainer" ? <SquarePill tone="sky">Retainer</SquarePill> : null}{service.isTest ? <SquarePill tone="yellow">Test</SquarePill> : null}</>}
                updated={service.lastEditedAt ? formatRelativeTime(service.lastEditedAt) : "never"}
            />
            <DetailFields>
                <DetailField label="Status" icon="status"><Status label={status.label} tone={status.tone} /></DetailField>
            </DetailFields>
            <ServiceEditor
                workspaceSlug={workspace.slug}
                service={service}
                assignees={configuration.assignees}
                schemaReady={configuration.schemaReady}
                presentation="page"
            />
        </div>
    </main>
}
