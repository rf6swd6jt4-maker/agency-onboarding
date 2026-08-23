import Link from "next/link"
import { Assignee } from "@/components/ui/Assignee"
import type { WorkspaceTeam } from "@/lib/teams/types"

export function WorkspaceTeamSettings({ workspaceSlug, teams, people, conversationIds, ownerCanEditMaintenance }: {
    workspaceSlug: string
    teams: WorkspaceTeam[]
    people: Array<{ id: string; name: string; avatarSrc: string | null }>
    conversationIds: Record<string, string>
    ownerCanEditMaintenance: boolean
}) {
    const peopleById = new Map(people.map((person) => [person.id, person]))
    const visible = teams.filter((team) => team.kind !== "custom" || !team.archivedAt)
    return <div className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900">
        {visible.map((team) => <section key={team.id} className="border-b border-neutral-800 p-4 last:border-0 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h3 className="font-semibold text-white">{team.name}</h3><span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500">{team.kind === "custom" ? "Fulfilment" : "Required"}</span></div><p className="mt-1 text-sm text-neutral-500">{team.kind === "admins" ? "Membership follows owner and admin roles in Users." : team.kind === "maintenance" ? "Routes platform maintenance categories to responsible team members." : `${team.responsibilities.length} service responsibility${team.responsibilities.length === 1 ? "" : "ies"}.`}</p></div>{conversationIds[team.id] ? <Link href={`/${workspaceSlug}/communications?mode=team&nativeConversation=${conversationIds[team.id]}`} className="inline-flex h-9 items-center rounded-lg border border-neutral-700 px-3 text-xs text-neutral-200 hover:border-neutral-500">{team.kind === "maintenance" && ownerCanEditMaintenance ? "Open and edit" : "Open chat"}</Link> : null}</div>
            <div className="mt-4 flex flex-wrap gap-2">{team.memberIds.map((userId) => { const person = peopleById.get(userId); return <Assignee key={userId} userId={userId} name={person?.name ?? "Workspace member"} avatarSrc={person?.avatarSrc ?? null} compact compactSize="md" /> })}</div>
            {team.kind === "maintenance" && team.maintenanceResponsibilities.length ? <div className="mt-4 grid gap-2 sm:grid-cols-2">{team.maintenanceResponsibilities.map((responsibility) => <div key={responsibility.category} className="flex items-center justify-between gap-3 rounded-lg bg-neutral-950 px-3 py-2 text-xs"><span className="capitalize text-neutral-500">{responsibility.category.replace(/_/g, " ")}</span><span className="truncate text-neutral-200">{peopleById.get(responsibility.userId)?.name ?? "Workspace member"}</span></div>)}</div> : null}
        </section>)}
        <div className="p-4 text-sm text-neutral-500 sm:p-5">Create and manage fulfilment teams from the <Link href={`/${workspaceSlug}/communications?mode=team`} className="text-neutral-200 underline decoration-neutral-600 underline-offset-4">Communications Team tab</Link>.</div>
    </div>
}
