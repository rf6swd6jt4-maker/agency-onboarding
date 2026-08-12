# Universal workspace connections

Settings connects every agency to its own Stripe and WhatsApp accounts. The
provider popup uses one shared lifecycle: stage credentials, verify required
capabilities, atomically activate them, retain one previous connection, and
route runtime requests and webhooks by workspace.

## Safe rollout

1. Apply `20260812110000_universal_workspace_connections.sql`.
2. Keep the existing Stripe and Meta environment variables. They remain the
   `platform_legacy` fallback for Scaylup until the new paths pass testing.
3. Configure the Stripe App and Meta app variables listed in `.env.example`.
4. Connect Scaylup in Settings. A failed candidate does not replace the active
   legacy connection. A successful candidate exposes **Restore previous**.
5. Test invoice creation, payment webhook receipt, WhatsApp confirmation,
   inbound `CONFIRM`, and onboarding-link delivery.
6. After observation, remove the legacy provider values in a later release.

Emergency rollback does not require a source revert: set
`WORKSPACE_CONNECTIONS_FORCE_LEGACY=true` and redeploy. It only affects a
connection whose saved previous mode is `platform_legacy`, so it cannot expose
Scaylup credentials to another agency. Settings also offers **Restore previous**
to make the database cutover permanent.

Do not remove legacy values in the same deployment that first enables the new
connections. Source rollback and credential rollback are deliberately separate.

## Stripe App

Create a public backend Stripe App using OAuth. Declare the minimum permissions
needed to read the account, create and manage customers/invoices/invoice items,
and receive invoice events. Add this exact callback URL to
`allowed_redirect_uris`:

`https://<dashboard-host>/api/workspace-connections/stripe/callback`

Set live and external-test authorize URLs separately. Configure the App event
destination to send invoice events to:

`https://<dashboard-host>/api/stripe/webhook`

Create separate test and live App event destinations. Store their signing
secrets as `STRIPE_APP_TEST_WEBHOOK_SECRET` and
`STRIPE_APP_LIVE_WEBHOOK_SECRET`. The older `STRIPE_APP_WEBHOOK_SECRET` remains
only as a temporary compatibility fallback. Events are matched to their mode,
mapped to a workspace by Stripe account/context, and checked against Betelgeze
invoice ownership before automation runs. An
`account.application.deauthorized` event disconnects the affected workspace
without affecting any other agency.

## Meta Embedded Signup

Create a Meta app with WhatsApp Embedded Signup and request the required
advanced permissions. Configure its JavaScript SDK domain and set the Embedded
Signup configuration ID. The callback is:

`https://<dashboard-host>/api/client-messages/meta/whatsapp`

The popup exchanges Meta's one-time code server-side, stores the agency token
encrypted, subscribes the selected WABA with a callback override, and verifies
the phone number and approved confirmation template. Inbound events are mapped
to the workspace by `metadata.phone_number_id` before any client or sale lookup.

## Immediate manual path

Both popups include **Use manual credentials**. This uses the same candidate,
verification, activation, runtime, webhook and rollback code as OAuth/Embedded
Signup. It is suitable for Scaylup testing while provider app reviews are still
pending; it is not a separate legacy mode.
