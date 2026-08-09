import { createHash } from "crypto"

export function profileAvatarUrl(username: string, avatarPath: string) {
    const version = createHash("sha256").update(avatarPath).digest("hex").slice(0, 12)

    return `/api/profile-avatars/${encodeURIComponent(username)}?v=${version}`
}
