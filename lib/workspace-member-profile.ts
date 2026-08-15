export const WORKSPACE_MEMBER_PROFILE_EVENT = "betelgeze:workspace-member-profile"
export const WORKSPACE_MEMBER_PROFILE_MESSAGE_SOURCE = "betelgeze:workspace-member-profile"

export function openWorkspaceMemberProfile(userId: string) {
    if (typeof window === "undefined" || !userId) return
    if (window.parent !== window) {
        window.parent.postMessage({ source: WORKSPACE_MEMBER_PROFILE_MESSAGE_SOURCE, userId }, window.location.origin)
        return
    }
    window.dispatchEvent(new CustomEvent(WORKSPACE_MEMBER_PROFILE_EVENT, { detail: { userId } }))
}
