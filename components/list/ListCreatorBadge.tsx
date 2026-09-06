import { ListCreatorAvatar } from "./ListCreatorAvatar"

export function ListCreatorBadge({ src, username, label, date }: { src?: string | null; username?: string | null; label: "Created by" | "Added by"; date: string }) {
    const name = username ? `@${username}` : "Betelgeze"
    return <div className="group relative inline-flex shrink-0">
        <ListCreatorAvatar src={src ?? null} username={username} className="h-7 w-7" />
        <div className="betelgeze-popup-enter pointer-events-none absolute right-0 top-9 z-[9999] hidden w-56 rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-left shadow-2xl group-hover:block group-focus-within:block">
            <p className="text-xs text-neutral-500">{label}</p>
            <p className="mt-1 truncate text-sm font-medium text-neutral-100">{name}</p>
            <p className="mt-1 text-xs text-neutral-500">{date}</p>
        </div>
    </div>
}
