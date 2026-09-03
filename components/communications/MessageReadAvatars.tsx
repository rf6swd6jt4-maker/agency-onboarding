import { Avatar } from "@/components/account/Avatar"
import type { CommunicationPerson } from "@/lib/communications/types"
import { openWorkspaceMemberProfile } from "@/lib/workspace-member-profile"

export function MessageReadAvatars({ readers }: { readers: CommunicationPerson[] }) {
    return <span className="flex min-w-0 items-center -space-x-1">
        {readers.map((person) => <button
            data-icon-button
            type="button"
            key={person.id}
            onClick={(event) => {
                event.stopPropagation()
                openWorkspaceMemberProfile(person.id)
            }}
            title={`Read in Betelgeze by ${person.name}`}
            aria-label={`Open ${person.name} profile`}
            className="relative inline-flex h-4 w-4 shrink-0 aspect-square items-center justify-center overflow-hidden rounded-full border border-black p-0 leading-none"
        >
            <Avatar src={person.avatarSrc} name={person.name} className="h-full w-full object-center" />
        </button>)}
    </span>
}
