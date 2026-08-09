import Link from "next/link"
import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { List, ListItem, ListPrimaryRow, ListSecondaryRow, ListTitle, ListTrailing } from "@/components/list/List"
import { ListActionMenu } from "@/components/list/ListActionMenu"
import { MobileListActionSurface } from "@/components/list/MobileCardActionSurface"
import { FilterRail, FilterRailCount, FilterRailLink } from "@/components/panel/FilterRail"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { QuickStats } from "@/components/panel/QuickStats"
import { SquarePill, Status, type StatusTone } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { listRelationshipsForWorkspace, relationshipHubHref, workspaceHref } from "@/lib/relationships"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
    searchParams: Promise<{ state?: string }>
}

function communicationStatus(direction: string, status: string): { label: string; tone: StatusTone } {
    const normalized = status.toLowerCase()
    if (normalized.includes("failed") || normalized.includes("error")) return { label: "Delivery failed", tone: "red" }
    if (direction === "inbound") return { label: "Needs reply", tone: "yellow" }
    if (normalized.includes("queued") || normalized.includes("pending")) return { label: "Sending", tone: "yellow" }
    if (normalized.includes("delivered") || normalized.includes("read")) return { label: "Delivered", tone: "green" }
    return { label: "Sent", tone: "green" }
}

function providerLabel(provider: string) {
    if (provider === "meta_whatsapp" || provider === "whatsapp") return "WhatsApp"
    if (provider === "clickup") return "ClickUp"
    return provider.replace(/_/g, " ")
}

export default async function CommunicationsPage({ params, searchParams }: PageProps) {
    const [{ workspaceSlug }, query] = await Promise.all([params, searchParams])
    const { workspace, user } = await requireWorkspace(workspaceSlug)
    const relationships = (await listRelationshipsForWorkspace(workspace.id)).filter((relationship) => relationship.status !== "archived")
    const clientIds = relationships.map((relationship) => relationship.client_id).filter((id): id is string => Boolean(id))
    const { data: messages } = clientIds.length
        ? await supabaseAdmin
            .from("client_messages")
            .select("client_id, body, direction, provider, status, created_at")
            .in("client_id", clientIds)
            .order("created_at", { ascending: false })
            .limit(120)
        : { data: [] }
    const latestMessageByClient = new Map<string, NonNullable<typeof messages>[number]>()
    for (const message of messages ?? []) {
        if (!latestMessageByClient.has(message.client_id)) latestMessageByClient.set(message.client_id, message)
    }

    const rows = relationships
        .flatMap((relationship) => {
            const latestMessage = relationship.client_id ? latestMessageByClient.get(relationship.client_id) ?? null : null
            return latestMessage ? [{ relationship, latestMessage }] : []
        })
        .sort((left, right) => right.latestMessage.created_at.localeCompare(left.latestMessage.created_at))
    const needsReplyRows = rows.filter((row) => row.latestMessage.direction === "inbound")
    const sentLastRows = rows.filter((row) => row.latestMessage.direction === "outbound")
    const selectedState = query.state === "inbound" || query.state === "outbound" ? query.state : null
    const visibleRows = selectedState === "inbound" ? needsReplyRows : selectedState === "outbound" ? sentLastRows : rows
    const filterHref = (state: string | null) => workspaceHref(workspace.slug, `communications${state ? `?state=${state}` : ""}`)

    return (
        <main className="min-h-screen bg-neutral-950 px-4 pb-7 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-7xl pt-5">
                <WorkspaceBanner bannerPath={workspace.banner_path} logoPath={workspace.logo_path} name={workspace.name} height={workspace.banner_height} position={workspace.banner_position} />
                <PanelTabHeader
                    title="Communications"
                    description="Relationship conversations ordered by their latest recorded message."
                />

                <QuickStats ariaLabel="Communication statistics" items={[
                    { label: "Relationships", value: relationships.length },
                    { label: "With messages", value: rows.length },
                    { label: "Needs reply", value: needsReplyRows.length },
                ]} />

                <FilterRail ariaLabel="Filter communications by latest direction">
                    <FilterRailLink href={filterHref(null)} selected={!selectedState}>All <FilterRailCount>{rows.length}</FilterRailCount></FilterRailLink>
                    <FilterRailLink href={filterHref("inbound")} selected={selectedState === "inbound"}>Needs reply <FilterRailCount>{needsReplyRows.length}</FilterRailCount></FilterRailLink>
                    <FilterRailLink href={filterHref("outbound")} selected={selectedState === "outbound"}>Sent last <FilterRailCount>{sentLastRows.length}</FilterRailCount></FilterRailLink>
                </FilterRail>

                <List ariaLabel="Relationship communications">
                    {visibleRows.length ? visibleRows.map(({ relationship, latestMessage }) => {
                        const href = relationshipHubHref(workspace.slug, relationship.id)
                        const title = relationship.business_name
                            ? `${relationship.primary_person_name} – ${relationship.business_name}`
                            : relationship.primary_person_name
                        const status = communicationStatus(latestMessage.direction, latestMessage.status)
                        const actions = [{ label: "Open relationship", href }]
                        return <ListItem key={relationship.id}>
                            <MobileListActionSurface actions={actions} label={`Open actions for ${title}`}>
                                <ListPrimaryRow>
                                    <ListTitle href={href} className="flex-1">{title}</ListTitle>
                                    <span className="hidden shrink-0 sm:inline-flex"><SquarePill className="capitalize">{providerLabel(latestMessage.provider)}</SquarePill></span>
                                    <Status label={status.label} tone={status.tone} className="ml-auto shrink-0" />
                                </ListPrimaryRow>
                                <ListSecondaryRow>
                                    <span className="min-w-0 flex-1 truncate text-neutral-300">{latestMessage.body || "No message body saved"}</span>
                                    <span className="hidden shrink-0 capitalize text-neutral-500 md:inline">{latestMessage.direction}</span>
                                    <ListTrailing>
                                        <span className="font-mono text-neutral-500">{shortId(relationship.id)}</span>
                                        <span className="whitespace-nowrap text-neutral-500">{formatRelativeTime(latestMessage.created_at)}</span>
                                        <ListActionMenu actions={actions} className="hidden sm:block" />
                                    </ListTrailing>
                                </ListSecondaryRow>
                            </MobileListActionSurface>
                        </ListItem>
                    }) : <div className="p-6">
                        <p className="text-lg font-semibold">{selectedState ? `No conversations were ${selectedState === "inbound" ? "received" : "sent"} last.` : "No relationship communications yet."}</p>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">{selectedState ? <>Choose another state or <Link href={filterHref(null)} className="text-neutral-200 underline decoration-neutral-600 underline-offset-4 hover:text-white">show all conversations</Link>.</> : "Recorded relationship messages will appear here in latest-activity order."}</p>
                    </div>}
                </List>
            </div>
        </main>
    )
}
