import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
    formatCalendarResponse,
    formatCalendarSelection,
    normalizeCalendarResponse,
    validateCalendarSelection,
} from "../lib/onboarding/calendar.ts"

const builder = readFileSync("components/onboarding-builder/OnboardingBuilderWorkspace.tsx", "utf8")
const canvas = readFileSync("components/onboarding-builder/VisualBuilderCanvas.tsx", "utf8")
const runtimeBlocks = readFileSync("components/onboarding/OnboardingBlocks.tsx", "utf8")
const calendarBlock = readFileSync("components/onboarding/CalendarDateTimeBlock.tsx", "utf8")
const publicActions = readFileSync("app/onboarding/session/[token]/actions.ts", "utf8")
const publicPage = readFileSync("app/onboarding/session/[token]/page.tsx", "utf8")
const stepSubmit = readFileSync("components/onboarding/OnboardingStepSubmit.tsx", "utf8")
const sessionRenderer = readFileSync("components/onboarding/OnboardingSessionRenderer.tsx", "utf8")
const canonical = readFileSync("lib/onboarding/canonical.ts", "utf8")
const staffDetail = readFileSync("app/[workspaceSlug]/onboarding/[relationshipId]/page.tsx", "utf8")
const helpLink = readFileSync("components/onboarding/RequestHelpLink.tsx", "utf8")
const migration = readFileSync("supabase/migrations/20260905090000_onboarding_calendar_and_portal_completion.sql", "utf8")

test("calendar responses retain the client's wall time, timezone, and canonical instant", () => {
    assert.deepEqual(validateCalendarSelection({
        date: "2026-11-18",
        time: "14:30",
        timezone: "Europe/Dublin",
    }), {
        date: "2026-11-18",
        time: "14:30",
        timezone: "Europe/Dublin",
    })
    assert.throws(() => validateCalendarSelection({ date: "2026-02-30", time: "14:30", timezone: "UTC" }), /valid date/u)
    assert.throws(() => validateCalendarSelection({ date: "2026-11-18", time: "25:00", timezone: "UTC" }), /valid time/u)
    assert.throws(() => validateCalendarSelection({ date: "2026-11-18", time: "14:30", timezone: "Not\/A_Timezone" }), /timezone/u)

    const normalized = normalizeCalendarResponse({
        date: "2026-11-18",
        time: "14:30",
        timezone: "Europe/Dublin",
        startsAt: "2026-11-18T14:30:00.000Z",
    })
    assert.equal(normalized?.startsAt, "2026-11-18T14:30:00.000Z")
    assert.match(formatCalendarResponse(normalized) ?? "", /Europe\/Dublin/u)
    assert.match(formatCalendarSelection(normalized) ?? "", /14:30 \(Europe\/Dublin\)/u)
})

test("the Calendar is a reusable Builder block rendered by preview and public onboarding", () => {
    assert.match(builder, /createCalendarBlock/u)
    assert.match(builder, /\["video", "form", "button", "calendar"\]/u)
    assert.doesNotMatch(builder, /Calendar[\s\S]{0,100}Coming later/u)
    assert.match(canvas, /<CalendarDateTimeBlock/u)
    assert.match(runtimeBlocks, /block\.kind === "calendar"/u)
    assert.match(calendarBlock, /type="time"/u)
    assert.match(calendarBlock, /browserTimezone\(\)/u)
    assert.match(publicActions, /rpc\("submit_onboarding_calendar_block"/u)
    assert.match(staffDetail, /requirement_kind", "calendar_scheduled"/u)
    assert.match(staffDetail, /formatCalendarResponse/u)
})

test("calendar persistence is token scoped, future only, and required before completion", () => {
    assert.match(migration, /'calendar_scheduled'/u)
    assert.match(migration, /session\.session_token = p_token/u)
    assert.match(migration, /session\.status = 'active'/u)
    assert.match(migration, /pg_timezone_names/u)
    assert.match(migration, /v_starts_at <= now\(\)/u)
    assert.match(migration, /new\.kind in \('calendar', 'connection'/u)
    assert.match(migration, /grant execute on function public\.submit_onboarding_calendar_block[\s\S]*to service_role/u)
})

test("failed portal finalization can be retried and cross-domain handoff uses a document navigation", () => {
    const portalTrigger = migration.slice(migration.indexOf("create or replace function public.provision_client_portal_after_onboarding"))
    assert.match(portalTrigger, /security invoker/u)
    assert.doesNotMatch(portalTrigger, /security definer/u)
    assert.match(portalTrigger, /status = 'active'/u)
    assert.match(canonical, /if \(resolved\.completedKeys\.has\(step\.key\)\)[\s\S]*everyStepIsComplete/u)
    assert.match(publicPage, /finalizationPending/u)
    assert.match(publicPage, /Finish onboarding/u)
    assert.match(stepSubmit, /window\.location\.assign\(outcome\.clientPortalUrl\)/u)
    assert.match(sessionRenderer, /Finish onboarding below to open your client portal/u)
})

test("client-facing save failures stay compact and can jump to visible help", () => {
    assert.match(stepSubmit, /text-left text-sm text-red-700/u)
    assert.match(stepSubmit, /<RequestHelpLink/u)
    assert.match(helpLink, /\[data-onboarding-help-card\]/u)
    assert.match(helpLink, /scrollIntoView/u)
})
