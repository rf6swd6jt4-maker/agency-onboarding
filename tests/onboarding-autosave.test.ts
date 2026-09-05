import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const form = readFileSync("components/onboarding/OnboardingForm.tsx", "utf8")
const fileField = readFileSync("components/onboarding/FileUploadField.tsx", "utf8")
const coordinator = readFileSync("components/onboarding/OnboardingSaveCoordinator.tsx", "utf8")
const appointment = readFileSync("components/onboarding/AppointmentSetupBlock.tsx", "utf8")
const calendar = readFileSync("components/onboarding/CalendarDateTimeBlock.tsx", "utf8")
const blocks = readFileSync("components/onboarding/OnboardingBlocks.tsx", "utf8")
const renderer = readFileSync("components/onboarding/OnboardingSessionRenderer.tsx", "utf8")
const layout = readFileSync("components/onboarding/OnboardingLayout.tsx", "utf8")
const submit = readFileSync("components/onboarding/OnboardingStepSubmit.tsx", "utf8")
const globalLoading = readFileSync("components/GlobalLoadingOverlay.tsx", "utf8")
const sessionPage = readFileSync("app/onboarding/session/[token]/page.tsx", "utf8")
const actions = readFileSync("app/onboarding/session/[token]/actions.ts", "utf8")
const canonical = readFileSync("lib/onboarding/canonical.ts", "utf8")
const migration = readFileSync("supabase/migrations/20260905100000_onboarding_fast_autosave.sql", "utf8")

test("onboarding saves stay inline and never cover the client's fields", () => {
    assert.doesNotMatch(form, /LoadingOverlay/u)
    assert.doesNotMatch(submit, /LoadingOverlay/u)
    assert.match(layout, /data-client-onboarding-session/u)
    assert.match(sessionPage, /<OnboardingLayout clientSession/u)
    assert.match(globalLoading, /!clientOnboardingAction/u)
    assert.match(form, /Saving changes…/u)
    assert.match(form, /All changes saved/u)
    assert.match(form, /readOnly=\{locked \|\| submitting\}/u)
})

test("files prepare in one request and upload concurrently as soon as they are selected", () => {
    assert.match(actions, /export async function prepareDirectUploads/u)
    assert.match(actions, /return Promise\.all\(validated\.map/u)
    assert.match(form, /startBackgroundUploads\(fieldName, files\)/u)
    assert.match(form, /await Promise\.all\(prepared\.map/u)
    assert.match(form, /await waitForCurrentUploads\(\)[\s\S]*submitPreparedFormStep/u)
    assert.match(fileField, /Uploads begin immediately in the background/u)
    assert.match(fileField, /Uploading \$\{upload\.progress\}%/u)
})

test("Continue flushes every registered block save before completing the step", () => {
    assert.match(coordinator, /await Promise\.all\(\[\.\.\.tasksRef\.current\.values\(\)\]/u)
    assert.match(blocks, /<OnboardingSaveCoordinator>/u)
    assert.match(appointment, /useOnboardingSaveTask/u)
    assert.match(calendar, /useOnboardingSaveTask/u)
    assert.ok(form.indexOf("await flushAll()") < form.indexOf("submitPreparedFormStep(token, stepKey, response)"))
    assert.ok(submit.indexOf("await flushAll()") < submit.indexOf("completePreparedStep(token, stepKey)"))
    assert.doesNotMatch(calendar, />Save date and time</u)
})

test("visual forms submit the frozen session field IDs used by server validation", () => {
    assert.match(blocks, /stepForm \?\? \{/u)
    assert.match(renderer, /stepForm=\{step\.form\}/u)
    assert.match(renderer, /<OnboardingBlocks[\s\S]*key=\{step\.key\}/u)
})

test("draft autosave uses one constrained token-scoped database call", () => {
    assert.match(actions, /rpc\("save_onboarding_step_draft"/u)
    assert.match(migration, /current_user <> 'service_role'/u)
    assert.match(migration, /session\.session_token = p_token/u)
    assert.match(migration, /jsonb_object_keys\(p_response\)/u)
    assert.match(migration, /on conflict \(session_step_id\) do update/u)
    assert.match(migration, /lock_version = public\.onboarding_step_drafts\.lock_version \+ 1/u)
    assert.match(migration, /grant execute on function public\.save_onboarding_step_draft[\s\S]*to service_role/u)
})

test("successful completion navigates directly to the known next step", () => {
    assert.match(canonical, /nextStepKey/u)
    assert.match(canonical, /completeCanonicalStep\(token, stepKey, \{ form, response \}, resolved\)/u)
    assert.match(canonical, /const clientPortalUrl = nextStepKey[\s\S]*\? null[\s\S]*: await maybeCompleteOnboarding/u)
    assert.match(actions, /onboardingPathForStep/u)
    assert.match(form, /router\.replace\(outcome\.nextPath\)/u)
    assert.match(submit, /router\.replace\(outcome\.nextPath\)/u)
    assert.doesNotMatch(submit, /router\.refresh\(\)/u)
    assert.match(canonical, /step\.sessionStepId && step\.bookendKind !== "completion"/u)
})
