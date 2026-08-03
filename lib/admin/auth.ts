import { timingSafeEqual } from "crypto"
import { headers } from "next/headers"
import { redirectToLogin } from "@/lib/auth/server-redirects"
import { getRequiredEnv } from "@/lib/env"
import { requireWorkspace } from "@/lib/workspaces"

export const ADMIN_SESSION_COOKIE = "admin_session"
export const ADMIN_COOKIE_PATH = "/"
export const LEGACY_ADMIN_COOKIE_PATH = "/admin"

function constantTimeCompare(value: string, expected: string) {
    const expectedBuffer = Buffer.from(expected)
    const valueBuffer = Buffer.from(value)

    if (valueBuffer.length !== expectedBuffer.length) {
        timingSafeEqual(expectedBuffer, Buffer.alloc(expectedBuffer.length))
        return false
    }

    return timingSafeEqual(valueBuffer, expectedBuffer)
}

export function isValidAdminPassword(password: string) {
    return constantTimeCompare(password, getRequiredEnv("ADMIN_PASSWORD"))
}

export function getAdminSessionSecret() {
    return getRequiredEnv("ADMIN_SESSION_SECRET")
}

export async function requireAdmin() {
    const workspaceSlug = (await headers()).get("x-betelgeze-workspace-slug")
    if (!workspaceSlug) return await redirectToLogin()
    return requireWorkspace(workspaceSlug, "admin")
}

export async function requireWorkspaceStaff() {
    const workspaceSlug = (await headers()).get("x-betelgeze-workspace-slug")
    if (!workspaceSlug) return await redirectToLogin()
    return requireWorkspace(workspaceSlug, "staff")
}
