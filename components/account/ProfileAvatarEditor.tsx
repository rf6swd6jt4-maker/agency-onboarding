"use client"

import { ChangeEvent, useRef } from "react"
import { Avatar } from "@/components/account/Avatar"
import { ProfileAvatarEditButton } from "@/components/account/ProfileAvatarEditButton"

export function ProfileAvatarEditor({
    name,
    src,
    action,
}: {
    name: string
    src: string | null
    action: (formData: FormData) => Promise<void>
}) {
    const input = useRef<HTMLInputElement>(null)
    function upload(event: ChangeEvent<HTMLInputElement>) {
        const file = event.currentTarget.files?.[0]
        if (!file) return
        event.currentTarget.form?.requestSubmit()
    }

    return <form action={action} className="flex flex-col items-start gap-3 sm:flex-row sm:items-center"><div className="relative"><Avatar src={src} name={name} className="h-24 w-24 border-2 border-neutral-700" /><ProfileAvatarEditButton onClick={() => input.current?.click()} className="absolute bottom-0 right-0 h-9 w-9 translate-x-1/4 translate-y-1/4" /><input ref={input} name="avatar" onChange={upload} className="sr-only" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/heic,image/heif" /></div><div><p className="text-sm font-medium text-neutral-200">Profile picture</p><p className="mt-1 text-sm text-neutral-400">Max resolution: 400×400px.</p></div></form>
}
