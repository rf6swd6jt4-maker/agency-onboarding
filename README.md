# Betelgeze

Multi-business automation platform. Each business has a private workspace for
client onboarding, team access, and later integrations.

## Current Features

- Email/password dashboard accounts with authenticator-app MFA.
- Isolated business workspaces with Owner, Admin, and Member roles.
- Admin dashboard with active clients, assigned modules, progress, and activity.
- Manual client creation without opening Supabase.
- Client detail page with onboarding link, notes, timeline, progress, and
  danger-zone actions.
- Client editing for name, email, and assigned modules.
- Module-based client onboarding flow.
- Supabase-backed progress tracking.

## Tech Stack

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- Supabase
- Vercel deployment

## Local Development

Install dependencies:

```bash
npm install
```

Create a local env file:

```bash
cp .env.example .env.local
```

Fill in the Supabase values, then run:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_BASE_URL=
SUNBIZ_SHARD_BASE_URL=
AZ_OWNER_SHARD_BASE_URL=
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=
SYSTEM_HEALTH_SUPABASE_DATABASE_LIMIT_MB=500
VERCEL_API_TOKEN=
VERCEL_TEAM_ID=
VERCEL_PROJECT_ID=
NEXT_PUBLIC_SITE_URL=https://betelgeze.com
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_DEFAULT_CURRENCY=eur
STRIPE_INVOICE_DAYS_UNTIL_DUE=7
META_WHATSAPP_CONSENT_TEMPLATE_NAME=
META_WHATSAPP_CONSENT_TEMPLATE_LANGUAGE=en
```

`SUPABASE_SERVICE_ROLE_KEY` must only be used server-side. Do not put a
business's Stripe, ClickUp, or Meta credentials in `NEXT_PUBLIC_*` variables.

## Supabase

The current schema is represented in
`supabase/migrations/20260601000000_initial_schema.sql`.

Tables used by the app:

- `clients`
- `client_modules`
- `client_progress`
- `client_notes`
- `client_activity`
- `client_form_responses`

Uploaded onboarding files are stored in a private Cloudflare R2 bucket. The
browser uploads directly to R2 with short-lived signed upload URLs, so large
videos do not pass through the Next.js server. Admin previews use signed
download URLs.

`R2_PUBLIC_BASE_URL` is optional and only affects admin/onboarding file links.
If you use it, set it to a Betelgeze-owned media hostname such as
`https://media.betelgeze.com`; legacy `*.scaylup.com` values are deliberately
ignored and the app uses secure signed R2 URLs instead.
WhatsApp media sent to ClickUp uses stable app media URLs that stream files from
private R2 storage.

Important constraints:

- `clients.session_token` is unique.
- `client_progress` is unique per `client_id` and `step_key`.
- `client_modules` is unique per `client_id` and `module_key`.
- `client_form_responses` is unique per `client_id` and `step_key`.

## Workspace Flow

1. Create an account at `/sign-up`, verify the email, and enrol an authenticator
   app at `/mfa`.
2. Log in at `/login` and open `/dashboard/[workspaceSlug]`.
3. Owners manage access at `/dashboard/[workspaceSlug]/users`.
4. Add clients and share the generated onboarding link.

## Client Flow

Clients open `/onboarding/[workspaceSlug]/[token]`, where `[token]` is their
private session token.
The onboarding flow is generated from the modules assigned to that client.

Form steps save structured answers to `client_form_responses`. Image, video,
and document uploads are stored in Cloudflare R2 and referenced from the saved
response JSON.

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run test
```

## Deployment

The project is designed for Vercel. Configure the same environment variables in
the Vercel project settings for the production deployment.

### Betelgeze cutover checklist

1. Add `betelgeze.com` and `www.betelgeze.com` to Vercel, then add the exact
   A/CNAME records Vercel requests in Namecheap.
2. Set `NEXT_PUBLIC_SITE_URL=https://betelgeze.com` for Production and redeploy.
3. In Supabase Auth, add `https://betelgeze.com/login` to redirect URLs and
   configure production email delivery before enabling public sign-up.
4. Create a new Stripe webhook at `https://betelgeze.com/api/stripe/webhook`,
   replace `STRIPE_WEBHOOK_SECRET`, and update Meta/ClickUp callback URLs.
5. Apply `20260620000000_betelgeze_workspaces.sql` in staging first, verify the
   ScaylUp backfill, then apply it in production.
6. Regenerate active onboarding links. The old hostname is intentionally removed
   and does not redirect.

## Client Messages Bridge

The bridge routes client WhatsApp messages through Meta WhatsApp Cloud API into
ClickUp Chat, then lets a protected webhook send team replies back to WhatsApp.

Required environment variables:

- `CLICKUP_API_TOKEN`
- `CLICKUP_WORKSPACE_ID`
- `CLICKUP_CLIENTS_SPACE_ID`
- `CLICKUP_CLIENT_FOLDER_TEMPLATE_ID`
- `META_WHATSAPP_ACCESS_TOKEN`
- `META_WHATSAPP_PHONE_NUMBER_ID`
- `META_WHATSAPP_BUSINESS_ACCOUNT_ID`
- `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- `CLIENT_MESSAGES_BRIDGE_SECRET`
- `META_WHATSAPP_CONSENT_TEMPLATE_NAME`
- `CLICKUP_BRIDGE_USER_NAME`, optional, defaults to `ScaylUp`
- `CLICKUP_BRIDGE_USER_ID`, optional, used to ignore bot-authored Chat messages
- `META_WHATSAPP_CONSENT_TEMPLATE_LANGUAGE`, optional, defaults to `en`

Setup:

1. Run the Supabase migrations.
2. Create a ClickUp Space for clients manually, then set
   `CLICKUP_CLIENTS_SPACE_ID` to that Space ID. Create a client Folder
   template with `Onboarding Information` and `Client Work` Lists, then set
   `CLICKUP_CLIENT_FOLDER_TEMPLATE_ID` to that template ID.
3. Add clients with their WhatsApp number as the primary contact. If ClickUp
   credentials are configured, the app creates a client Folder from the
   template inside the Clients Space, creates initial onboarding tasks, creates
   a ClickUp Chat channel for that Folder, and stores the WhatsApp bridge
   mapping.
4. In Meta, point the WhatsApp webhook callback URL to:
   `/api/client-messages/meta/whatsapp`
5. To send a team reply back to the client manually, post JSON to:
   `/api/client-messages/clickup/outbound`
6. To send team ClickUp Chat replies back to WhatsApp, create a ClickUp Chat
   webhook Automation for "Message is posted" and send it to:
   `/api/client-messages/clickup/chat`
7. If ClickUp Chat webhooks are not available on your plan, use an external
   scheduler to call:
   `/api/client-messages/clickup/poll`

For testing, the client admin page still lets you fill in or override the client
WhatsApp number and ClickUp Chat channel ID manually.

Outbound replies require either an `Authorization: Bearer ...` header or an
`x-bridge-secret` header matching `CLIENT_MESSAGES_BRIDGE_SECRET`.

Example outbound body:

```json
{
  "clientId": "CLIENT_UUID",
  "authorName": "Team",
  "body": "Thanks, we have this and will update you shortly."
}
```

Recommended ClickUp Chat Automation webhook body:

```json
{
  "clickupChannelId": "{{channel.id}}",
  "body": "{{message.text}}",
  "authorName": "{{user.name}}",
  "authorId": "{{user.id}}",
  "clickupMessageId": "{{message.id}}"
}
```

The bridge ignores messages posted by the bridge user, messages from
`CLICKUP_BRIDGE_USER_ID`, system-style messages that begin with `Update` or
`ERROR` formatting markers, and recent echoes of inbound client WhatsApp
messages.

Polling endpoint:

```text
GET /api/client-messages/clickup/poll
```

Authorize it with either:

```text
x-bridge-secret: CLIENT_MESSAGES_BRIDGE_SECRET
```

or, only when your scheduler cannot send headers:

```text
/api/client-messages/clickup/poll?secret=CLIENT_MESSAGES_BRIDGE_SECRET
```

## Stripe Invoice Automation

Admins can create and send Stripe invoices from `/admin/sales/new`.

Required environment variables:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_DEFAULT_CURRENCY`, optional, defaults to `eur`
- `STRIPE_INVOICE_DAYS_UNTIL_DUE`, optional, defaults to `7`
- `META_WHATSAPP_CONSENT_TEMPLATE_NAME`
- `META_WHATSAPP_CONSENT_TEMPLATE_LANGUAGE`, optional, defaults to `en`

Flow:

1. Admin creates a Stripe invoice with client details, WhatsApp number, project
   timeframe, selected services, and service line amounts.
2. Stripe emails the invoice to the client.
3. Stripe posts paid invoice events to `/api/stripe/webhook`.
4. Payment atomically creates or resumes the sale-linked onboarding session,
   then the app sends the approved WhatsApp consent template.
5. When the client replies `CONFIRM`, the app reuses that session, creates any
   remaining client/ClickUp infrastructure, and queues the onboarding link for
   durable WhatsApp delivery.

Configure the Stripe webhook endpoint to send at least:

- `invoice.paid`
- `invoice.payment_succeeded`
- `invoice.payment_failed`
- `invoice.voided`
- `invoice.marked_uncollectible`

Onboarding links and active-module update notices are delivered through the
durable onboarding outbox. Set `CRON_SECRET`, then schedule either `GET` or
`POST /api/cron/onboarding-outbox` with this header:

```text
Authorization: Bearer CRON_SECRET
```

Run it at least every 15 minutes so failed or abandoned delivery claims are
reclaimed promptly. The endpoint fails closed when `CRON_SECRET` is missing or
incorrect and returns aggregate counts only.
