import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
    return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("workspace invitations are persisted only after SMTP accepts the message", () => {
    const action = source("app/[workspaceSlug]/users/actions.ts")
    const start = action.indexOf("export async function inviteWorkspaceUser")
    const end = action.indexOf("export async function updateWorkspaceUserRole", start)
    const invitationAction = action.slice(start, end)

    const send = invitationAction.indexOf("await sendWorkspaceInvitation")
    const persist = invitationAction.indexOf('.from("workspace_invitations").upsert')

    assert.match(invitationAction, /existingInvitation\?\.id \?\? crypto\.randomUUID\(\)/)
    assert.ok(send >= 0 && persist > send)
})

test("SMTP uses LOGIN and retains safe provider diagnostics", () => {
    const email = source("lib/email.ts")

    assert.match(email, /authMethod: "LOGIN"/)
    assert.match(email, /providerCommand: classified\.providerCommand/)
    assert.match(email, /providerResponseCode: classified\.providerResponseCode/)
    assert.match(email, /providerResponse: classified\.providerResponse/)
    assert.match(email, /\.replace\(\/\[A-Z0-9\._%\+\-\]\+@/)
})
