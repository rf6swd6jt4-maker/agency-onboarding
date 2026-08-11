"use client"

import { useFormStatus } from "react-dom"

function ArchiveButton() {
    const { pending } = useFormStatus()

    return (
        <button
            type="submit"
            disabled={pending}
            className="rounded-lg border border-red-900/80 px-3 py-2 text-xs font-medium text-red-300 transition hover:bg-red-950/40 disabled:cursor-wait disabled:opacity-60"
        >
            {pending ? "Archiving…" : "Archive relationship"}
        </button>
    )
}

export function ArchiveRelationshipForm({
    action,
    relationshipName,
}: {
    action: () => void
    relationshipName: string
}) {
    return (
        <form
            action={action}
            onSubmit={(event) => {
                const confirmed = window.confirm(
                    `Archive ${relationshipName}? It will leave active lists and will no longer claim WhatsApp confirmations. Its history will be preserved.`,
                )
                if (!confirmed) event.preventDefault()
            }}
        >
            <ArchiveButton />
        </form>
    )
}
