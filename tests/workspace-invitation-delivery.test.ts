import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
    return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("workspace invitations are persisted with a hashed rotating token before delivery", () => {
    const action = source("app/[workspaceSlug]/users/actions.ts")
    const start = action.indexOf("export async function inviteWorkspaceUser")
    const end = action.indexOf("export async function removeWorkspaceUser", start)
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

    assert.match(form, /setSubmitError\(result\.message\)/)
    assert.match(form, /role="alert"/)
    assert.match(settings, /<WorkspaceInvitationForm workspaceSlug=\{workspace\.slug\} action=\{inviteWorkspaceUser\.bind\(null, workspace\.slug\)\}/)
})

test("Staff invitations cannot be submitted without an assigned service", () => {
    const form = source("components/admin/WorkspaceInvitationForm.tsx")
    const action = source("app/[workspaceSlug]/users/actions.ts")

    assert.match(
        form,
        /const invitationDisabled = pending \|\| \(role === "staff" && selectedServiceIds\.size === 0\)/,
    )
    assert.match(form, /disabled=\{invitationDisabled\}/)
    assert.match(action, /requestedRole === "staff" && !serviceIds\.length/)
    assert.match(action, /Choose at least one service for this Staff member\./)
})

test("Add user is a lookup-first popup with account and pending invitation statuses", () => {
    const form = source("components/admin/WorkspaceInvitationForm.tsx")
    const lookup = source("app/api/workspaces/[workspaceSlug]/users/lookup/route.ts")
    const migration = source("supabase/migrations/20260903090000_workspace_invitation_target_lookup.sql")

    assert.match(form, />Add user</)
    assert.match(form, /fixed inset-0[\s\S]*items-center justify-center/)
    assert.match(form, /Username or email/)
    assert.match(form, /On Betelgeze/)
    assert.match(form, /Not on Betelgeze/)
    assert.match(form, /Invite to BE pending/)
    assert.match(form, /Invite to workspace pending/)
    assert.match(form, /"Invite to workspace" \| "Invite to Betelgeze"/)
    assert.match(form, /WorkspaceSuccessNotice label=\{notice\}/)
    assert.match(form, /setNotice\("Invitation email sent"\)/)
    assert.match(lookup, /requireWorkspace\(workspaceSlug, "admin"\)/)
    assert.match(lookup, /lookup_workspace_invitation_target/)
    assert.match(migration, /join auth\.users account on account\.id = profile\.user_id/)
    assert.match(migration, /lower\(account\.email\) = v_identifier/)
    assert.match(migration, /v_actor_role is null or v_actor_role not in \('owner', 'admin'\)/)
    assert.match(migration, /invitation\.accepted_at is null/)
    assert.match(migration, /invitation\.expires_at > now\(\)/)
    assert.match(migration, /grant execute on function public\.lookup_workspace_invitation_target\(uuid, uuid, text\) to service_role/)
})
