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
    assert.match(invitationAction, /return \{ ok: false, message: `Invitation failed because \$\{reason\}\. Nothing was saved\.` \}/)
})

test("SMTP uses LOGIN and retains safe provider diagnostics", () => {
    const email = source("lib/email.ts")

    assert.match(email, /authMethod: "LOGIN"/)
    assert.match(email, /connectionTimeout: 10_000/)
    assert.match(email, /socketTimeout: 15_000/)
    assert.match(email, /host === "mail\.privateemail\.com"/)
    assert.match(email, /smtpTransporter\(\{ port: 465, secure: true \}\)\.sendMail\(message\)/)
    assert.match(email, /providerCommand: classified\.providerCommand/)
    assert.match(email, /providerResponseCode: classified\.providerResponseCode/)
    assert.match(email, /providerResponse: classified\.providerResponse/)
    assert.match(email, /\.replace\(\/\[A-Z0-9\._%\+\-\]\+@/)
})

test("invitation failures stay inline instead of crashing Settings", () => {
    const form = source("components/admin/WorkspaceInvitationForm.tsx")
    const settings = source("app/[workspaceSlug]/settings/page.tsx")

    assert.match(form, /useActionState\(action, \{\}\)/)
    assert.match(form, /data-global-loading="false"/)
    assert.match(form, /role=\{state\.ok \? "status" : "alert"\}/)
    assert.match(settings, /<WorkspaceInvitationForm action=\{inviteWorkspaceUser\.bind\(null, workspace\.slug\)\}/)
})
