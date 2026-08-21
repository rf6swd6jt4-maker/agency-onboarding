# Account System V2 rollout

Account System V2 is invitation-only and fails closed until `ACCOUNT_FLOW_V2_ENABLED=true`. The flag keeps the legacy login presentation and pauses new invitations; password recovery and MFA remain available.

## 1. Apply and verify the database migration

Apply `supabase/migrations/20260821120000_account_system_v2.sql` to the intended Supabase project. A code build does not prove that this migration ran. Verify the new tables, invitation columns, functions, policies, and grants directly in that project before continuing.

The migration adds AAL2 checks to workspace/profile RLS and Realtime authorization. Test an AAL1 session against both REST and Realtime before enabling the flow.

## 2. Configure production services

- Point `auth.betelgeze.com` at the existing Next/Vercel application.
- Set the Supabase Site URL and redirect allowlist to include the exact production routes on `https://auth.betelgeze.com`, especially `/auth/callback`, `/sign-up/about`, and `/forgot-password/new-password`.
- Keep Supabase email OTP length at six digits, enable secure email change, and verify the configured OTP and invitation expiry values against the copy shown in each flow.
- Configure the Supabase HTTPS Send Email Hook as `https://auth.betelgeze.com/api/auth/send-email-hook` and store its generated `SEND_EMAIL_HOOK_SECRET` in Vercel.
- Configure a Resend webhook for send, delivery, delay, failure, bounce, suppression, and complaint events at `https://auth.betelgeze.com/api/email/resend-webhook`. Store its signing secret as `RESEND_WEBHOOK_SECRET`.
- Keep `RESEND_API_KEY`, `EMAIL_FROM`, and the monitored `EMAIL_REPLY_TO` server-only.
- Disable Resend click/open tracking and link rewriting for the authentication sending domain. This is a provider setting, not a success condition inferred from an API response.
- Keep `ACCOUNT_FLOW_V2_ENABLED=false` until the staging and production checks below pass.

## 3. Exercise the flow

In staging, cover a new invited account, an existing invited account, expired/revoked/replaced links, username collision, skipped profile details, email OTP resend, primary TOTP enrolment, backup factor enrolment, password recovery, another open login tab, and administrative MFA reset permissions.

Repeat the complete journey in production with a fresh alternate email address. Confirm inbox receipt and Resend's final delivery event; an accepted API request is only `sent`, not `delivered`.

## 4. Optional database cleanup

The cleanup is separate from deployment and must never be run implicitly. First capture a database backup and resolve the exact protected Auth user UUID and ScaylUp workspace UUID.

Dry run:

```sh
psql "$DATABASE_URL" -v execute=false \
  -v protected_user_id='<recorded-auth-user-uuid>' \
  -v protected_email='jedryszczyk@scaylup.com' \
  -v protected_username='jedryszczyk' \
  -v scaylup_workspace_id='<recorded-scaylup-workspace-uuid>' \
  -f scripts/reset-account-system-v2.sql
```

Save and review the manifest, row counts, reassignment coverage, and external-provider orphan report. Execution additionally requires `-v execute=true -v confirmation='DELETE ALL BETELGEZE TEST ACCOUNTS'`. The script does not delete Stripe, R2, Resend, or other provider assets.

## 5. Enable and monitor

Set `ACCOUNT_FLOW_V2_ENABLED=true`, deploy, and send a new invitation. Monitor onboarding sessions, invitation acceptance, OTP resends, MFA resets, account error codes, and Resend delayed/failed/bounced/suppressed states. Rollback is the flag: turn it off to restore the legacy login presentation and pause new invitation-led account creation without reopening unrestricted signup.
