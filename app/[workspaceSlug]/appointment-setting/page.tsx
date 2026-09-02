import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { requireWorkspacePanel } from "@/lib/workspace-access"

export const dynamic = "force-dynamic"

export default async function AppointmentSettingPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await params
    const { workspace, user } = await requireWorkspacePanel(workspaceSlug, "appointment-setting")
    return <main className="min-h-screen bg-neutral-950 px-4 pb-7 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
        <div className="mx-auto max-w-7xl pt-5">
            <WorkspaceBanner bannerPath={workspace.banner_path} logoPath={workspace.logo_path} name={workspace.name} height={workspace.banner_height} position={workspace.banner_position} />
            <PanelTabHeader title="Appointment Setting" description="Leads, booking activity, setter availability, and appointment outcomes." />
            <section className="mt-5 rounded-2xl border border-neutral-800 bg-black p-6">
                <h2 className="text-lg font-semibold">No appointment activity yet</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">This panel is available to Staff assigned an Appointment Setting service. Native leads, bookings, and outcomes will appear here as that workflow is added.</p>
            </section>
        </div>
    </main>
}
