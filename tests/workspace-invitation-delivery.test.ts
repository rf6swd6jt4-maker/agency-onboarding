import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
    return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("workspace invitations are persisted with a hashed rotating token before delivery", () => {
    const action = source("app/[workspaceSlug]/users/actions.ts")
    const start = action.indexOf("export async function inviteWorkspaceUser")
    const end = action.indexOf("export async function updateWorkspaceUserRole", start)
    const invitationAction = action.slice(start, end)

    const send = invitationAction.indexOf("await sendWorkspaceInvitation")
    const persist = invitationAction.indexOf('rpc("rotate_workspace_invitation"')

    assert.match(invitationAction, /proposedInvitationId = crypto\.randomUUID\(\)/)
    assert.ok(persist >= 0 && send > persist)
    assert.match(invitationAction, /invitationTokenHash = hashAccountToken\(invitationToken\)/)
    assert.match(invitationAction, /\.eq\("token_hash", invitationTokenHash\)/)
    assert.match(invitationAction, /The invitation was saved, but its email failed/)
})

test("transactional email uses Resend and retains safe provider diagnostics", () => {
    const email = source("lib/email.ts")

    assert.match(email, /import \{ Resend, type ErrorResponse \} from "resend"/)
    assert.match(email, /new Resend\(getEmailEnv\("RESEND_API_KEY"\)\)/)
    assert.match(email, /await resend\.emails\.send\(\{/)
    assert.match(email, /Betelgeze <noreply@betelgeze\.com>/)
    assert.match(email, /replyTo: process\.env\.EMAIL_REPLY_TO\?\.trim\(\) \|\| "hello@betelgeze\.com"/)
    assert.doesNotMatch(email, /SMTP_|nodemailer|sendMail/)
    assert.match(email, /providerCommand: classified\.providerCommand/)
    assert.match(email, /providerResponseCode: classified\.providerResponseCode/)
    assert.match(email, /providerResponse: classified\.providerResponse/)
    assert.match(email, /\.replace\(\/\[A-Z0-9\._%\+\-\]\+@/)
})

test("invitation copy identifies the inviter and explains unexpected messages", () => {
    const email = source("lib/email.ts")
    const action = source("app/[workspaceSlug]/users/actions.ts")

    assert.match(action, /\.from\("user_profiles"\)/)
    assert.match(action, /\.select\("display_name, username"\)/)
    assert.match(action, /sendWorkspaceInvitation\(\{ to: email, workspaceName: workspace\.name, inviterName, inviteUrl, invitationId \}\)/)
    assert.match(email, /invited you to join the \$\{workspaceName\} workspace/)
    assert.match(email, /If you were not expecting this invitation, you can safely ignore it/)
    assert.match(email, /No account or workspace access is created/)
    assert.match(email, /invitation expires in seven days/)
})

test("invitation failures stay inline instead of crashing Settings", () => {
    const form = source("components/admin/WorkspaceInvitationForm.tsx")
    const settings = source("app/[workspaceSlug]/settings/page.tsx")

    assert.match(form, /useActionState\(action, \{\}\)/)
    assert.match(form, /data-global-loading="false"/)
    assert.match(form, /role=\{state\.ok \? "status" : "alert"\}/)
    assert.match(settings, /<WorkspaceInvitationForm action=\{inviteWorkspaceUser\.bind\(null, workspace\.slug\)\}/)
})
