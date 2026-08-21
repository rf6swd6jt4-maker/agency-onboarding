import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import test from "node:test"
import React from "react"
import { render } from "@react-email/render"
import ts from "typescript"
import { passwordRequirements } from "../lib/auth/password.ts"
import { normalizeUsername, usernameFromEmail, usernameValidationMessage } from "../lib/auth/username.ts"

function source(path: string) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8") }

test("username suggestions are deterministic and schema-compatible", () => {
    assert.equal(usernameFromEmail("Alex.Smith+work@example.com"), "alex-smith-work")
    assert.equal(normalizeUsername(" --A Very Odd Name-- "), "a-very-odd-name")
    assert.equal(usernameValidationMessage("ab"), "Use at least 3 characters.")
    assert.equal(usernameValidationMessage("valid-user"), null)
    assert.match(usernameValidationMessage("valid user") ?? "", /lowercase letters/)
})

test("username entry preserves raw typing and validates instead of rewriting", () => {
    const flow = source("components/auth/AccountOnboardingFlow.tsx")
    const availability = source("app/api/account/username/route.ts")
    const onboarding = source("app/api/account/onboarding/route.ts")
    assert.match(flow, /setUsername\(event\.target\.value\)/)
    assert.doesNotMatch(flow, /setUsername\(normalizeUsername\(event\.target\.value\)\)/)
    assert.doesNotMatch(flow, /maxLength=\{30\}/)
    assert.match(availability, /const username = request\.nextUrl\.searchParams\.get\("value"\) \?\? ""/)
    assert.match(onboarding, /const username = String\(body\?\.username \?\? ""\)/)
})

test("password requirements reject short or one-class passwords", () => {
    assert.equal(passwordRequirements("short").every((item) => item.met), false)
    assert.equal(passwordRequirements("alllowercasepassword").every((item) => item.met), false)
    assert.equal(passwordRequirements("Calm-Password-2026").every((item) => item.met), true)
})

test("account onboarding completion is transactional and AAL2-gated", () => {
    const migration = source("supabase/migrations/20260821120000_account_system_v2.sql")
    assert.match(migration, /auth\.jwt\(\) ->> 'aal'/)
    assert.match(migration, /if v_aal <> 'aal2'/)
    assert.match(migration, /email_confirmed_at is not null/)
    assert.match(migration, /for update;/)
    assert.match(migration, /insert into public\.workspace_memberships/)
    assert.match(migration, /existing_membership\.role = 'owner'/)
    assert.match(migration, /delivery_status = 'accepted'/)
    assert.match(migration, /grant execute on function public\.complete_account_onboarding\(text\) to authenticated/)
})

test("invitation and continuation secrets are stored only as hashes", () => {
    const migration = source("supabase/migrations/20260821120000_account_system_v2.sql")
    const invitation = source("app/invitation/route.ts")
    const accountFlow = source("lib/auth/account-flow.ts")
    const accountTokens = source("lib/auth/account-tokens.ts")
    assert.match(migration, /token_hash text/)
    assert.match(migration, /browser_token_hash text not null unique/)
    assert.match(invitation, /exchangeInvitationToken\(token\)/)
    assert.match(accountFlow, /p_browser_token_hash: hashAccountToken\(browserToken\)/)
    assert.match(migration, /token_exchanged_at is not null/)
    assert.match(migration, /for update;/)
    assert.match(migration, /rotate_workspace_invitation/)
    assert.match(migration, /delete from public\.account_onboarding_sessions/)
    assert.match(accountTokens, /createHash\("sha256"\)/)
    assert.doesNotMatch(migration, /password text|otp_secret|raw_token/)
})

test("canonical auth routing and recovery preserve MFA", () => {
    const proxy = source("proxy.ts")
    const origin = source("lib/auth/origin.ts")
    const recovery = source("app/api/auth/recovery/route.ts")
    const loginPage = source("app/login/page.tsx")
    const login = source("components/auth/LoginV2.tsx")
    assert.match(proxy, /"\/sign-up", "\/invitation"/)
    assert.match(proxy, /sessionState\.aal !== "aal2"/)
    assert.match(proxy, /AUTH_API_PATHS/)
    assert.match(proxy, /"\/api\/account\/onboarding"/)
    assert.match(proxy, /"\/api\/auth\/mfa"/)
    assert.match(proxy, /isAuthHostPath\(path\)/)
    assert.match(proxy, /authHostname\(\)/)
    assert.match(origin, /NEXT_PUBLIC_AUTH_URL/)
    assert.match(origin, /new URL\(candidate\)\.origin/)
    assert.match(recovery, /verifyOtp\(\{ email, token: code, type: "recovery" \}\)/)
    assert.match(recovery, /account_password_recovery_sessions/)
    assert.match(recovery, /recoverySession\.auth_user_id !== authData\.user\.id/)
    assert.match(recovery, /RECOVERY_VERIFIED_COOKIE/)
    assert.match(recovery, /signOut\(\{ scope: "local" \}\)/)
    assert.match(login, /password-reset-complete/)
    assert.doesNotMatch(login, /postMessage\([^\n]*password[^\n]*value/i)
    assert.match(loginPage, /accountFlowV2Enabled\(\) \? <LoginV2 \/> : <LegacyLogin \/>/)
})

test("account emails share one template and verify both webhook boundaries", () => {
    const template = source("lib/email/AccountEmail.tsx")
    const authHook = source("app/api/auth/send-email-hook/route.ts")
    const resendHook = source("app/api/email/resend-webhook/route.ts")
    assert.match(template, /BETELGEZE/)
    assert.match(template, /transform: "rotate\(45deg\)"/)
    assert.match(authHook, /new Webhook\(secret\)\.verify/)
    assert.match(authHook, /email_change_current/)
    assert.match(authHook, /email_change_new/)
    assert.match(authHook, /magic_link" \? "magiclink"/)
    assert.match(authHook, /userId: null, purpose: "signup_otp"/)
    assert.match(resendHook, /webhooks\.verify/)
    assert.match(resendHook, /email\.delivery_delayed/)
    assert.match(resendHook, /record_account_email_delivery_event/)
})

test("account field feedback opts into wrapping status content", () => {
    const status = source("components/ui/Status.tsx")
    const feedback = source("components/auth/AuthFieldFeedback.tsx")
    assert.match(status, /wrap \? "min-w-0 items-start whitespace-normal"/)
    assert.match(status, /min-w-0 break-words/)
    assert.match(feedback, /tone=\{tone\} wrap/)
})

test("account email template renders accessible HTML and matching plain text", async () => {
    const compiled = ts.transpileModule(source("lib/email/AccountEmail.tsx"), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const emailModule = { exports: {} as Record<string, unknown> }
    const evaluate = new Function("require", "module", "exports", compiled)
    evaluate(createRequire(import.meta.url), emailModule, emailModule.exports)
    const AccountEmail = emailModule.exports.AccountEmail as React.ComponentType<Record<string, unknown>>
    const element = React.createElement(AccountEmail, {
        preview: "Your recovery code is 482193.",
        heading: "Recover your password",
        body: "Enter this code in Betelgeze.",
        code: "482193",
        actionLabel: "Continue securely",
        actionUrl: "https://auth.betelgeze.com/auth/callback?token_hash=test",
        expires: "This code expires shortly.",
        tone: "yellow",
    })
    const [html, plainText] = await Promise.all([render(element), render(element, { plainText: true })])
    assert.match(html, /Recover your password/)
    assert.match(html, /482193/)
    assert.match(html, /Continue securely/)
    assert.match(html, /If the button does not work/)
    assert.doesNotMatch(html, /<script/i)
    assert.match(plainText, /recover your password/i)
    assert.match(plainText, /482193/)
    assert.match(plainText, /https:\/\/auth\.betelgeze\.com\/auth\/callback/)
    assert.doesNotMatch(plainText, /<[^>]+>/)
})

test("database and server guards reject AAL1 workspace access", () => {
    const migration = source("supabase/migrations/20260821120000_account_system_v2.sql")
    const aal = source("lib/auth/aal.ts")
    assert.match(migration, /create or replace function public\.current_session_is_aal2/)
    assert.match(migration, /coalesce\(auth\.jwt\(\) ->> 'aal', ''\) = 'aal2'/)
    assert.match(migration, /and mfa_reenrollment_required/)
    assert.match(migration, /public\.current_session_is_aal2\(\)\s+and exists/)
    assert.match(aal, /export async function requireAuthenticatedUser/)
    assert.match(aal, /export async function requireAal2User/)
})

test("guarded reset defaults to rollback and requires exact identities", () => {
    const cleanup = source("scripts/reset-account-system-v2.sql")
    assert.match(cleanup, /\\set execute false/)
    assert.match(cleanup, /Protected account identity mismatch/)
    assert.match(cleanup, /ScaylUp workspace identity mismatch/)
    assert.match(cleanup, /DELETE ALL BETELGEZE TEST ACCOUNTS/)
    assert.match(cleanup, /update public\.work_items\s+set execution_owner_id/)
    assert.match(cleanup, /betelgeze_preserved_invariants/)
    assert.match(cleanup, /ScaylUp preserved-data invariant failed; transaction rolled back\. Mismatches/)
    assert.match(cleanup, /'before_hash', before_state\.payload_hash/)
    assert.match(cleanup, /'after_hash', after_state\.payload_hash/)
    assert.match(cleanup, /participant_account_removed/)
    assert.equal((cleanup.match(/null::uuid/g) ?? []).length, 2)
    assert.match(cleanup, /disable trigger enforce_workspace_okr_definition_lock/)
    assert.match(cleanup, /set created_by = null[\s\S]*target\.id = okr\.created_by/)
    assert.match(cleanup, /enable trigger enforce_workspace_okr_definition_lock/)
    assert.match(cleanup, /disable trigger work_items_updated_at[\s\S]*target\.id = item\.created_by[\s\S]*enable trigger work_items_updated_at/)
    assert.match(cleanup, /disable trigger relationship_onboarding_sessions_updated_at[\s\S]*target\.id = session\.created_by[\s\S]*enable trigger relationship_onboarding_sessions_updated_at/)
    assert.match(cleanup, /\\else\s+rollback;/)
})

test("account removal retains Builder and Communications authorship", () => {
    const migration = source("supabase/migrations/20260821130000_preserve_workspace_history_on_account_removal.sql")
    const teams = source("lib/teams/server.ts")
    for (const constraint of [
        "onboarding_builder_updates_actor_user_id_fkey",
        "workspace_native_messages_sender_user_id_fkey",
        "workspace_native_reactions_reactor_user_id_fkey",
        "client_messages_sender_user_id_fkey",
        "communication_reactions_reactor_user_id_fkey",
    ]) assert.match(migration, new RegExp(constraint))
    assert.match(migration, /account_user_attributions/)
    assert.match(migration, /conversation\.archived_at is null/)
    assert.match(teams, /formerPeople/)
    assert.match(teams, /Former member · read-only history/)
})

test("workspace deletion does not recreate system teams during membership cascades", () => {
    const migration = source("supabase/migrations/20260821140000_guard_system_team_sync_on_workspace_delete.sql")
    assert.match(migration, /if not exists \(\s*select 1\s*from public\.workspaces\s*where id = target_workspace/)
    assert.match(migration, /if tg_op = 'DELETE' then\s*return old;\s*end if;\s*return new;/)
})

test("administrative MFA reset is role-gated, strongly confirmed, and audited", () => {
    const actions = source("app/[workspaceSlug]/users/actions.ts")
    const dialog = source("components/admin/AdminMfaResetButton.tsx")
    assert.match(actions, /targetRole === "owner"/)
    assert.match(actions, /actingRole === "admin" && targetRole !== "staff"/)
    assert.match(actions, /`RESET \$\{email\}`/)
    assert.match(actions, /mfa_reenrollment_required: true/)
    assert.match(actions, /event_type: "mfa_admin_reset"/)
    assert.match(actions, /sendSecurityNotice/)
    assert.match(dialog, /role="dialog"/)
    assert.doesNotMatch(dialog, /window\.prompt/)
    const mfa = source("app/api/auth/mfa/route.ts")
    assert.match(mfa, /reenrollmentRequired/)
    assert.match(mfa, /factor\.status !== "unverified"/)
})
