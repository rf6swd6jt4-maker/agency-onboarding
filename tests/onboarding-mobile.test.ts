import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const layout = readFileSync("components/onboarding/OnboardingLayout.tsx", "utf8")
const mobileBar = readFileSync("components/onboarding/MobileStepBar.tsx", "utf8")
const renderer = readFileSync("components/onboarding/OnboardingSessionRenderer.tsx", "utf8")
const blocks = readFileSync("components/onboarding/OnboardingBlocks.tsx", "utf8")
const form = readFileSync("components/onboarding/OnboardingForm.tsx", "utf8")
const calendar = readFileSync("components/onboarding/CalendarDateTimeBlock.tsx", "utf8")
const appointment = readFileSync("components/onboarding/AppointmentSetupBlock.tsx", "utf8")
const profile = readFileSync("components/onboarding/ProfileMenu.tsx", "utf8")
const testMenu = readFileSync("components/onboarding/TestClientMenu.tsx", "utf8")
const smsPage = readFileSync("app/onboarding/smsoptin/page.tsx", "utf8")

test("public onboarding reserves safe mobile space for compact fixed progress", () => {
    assert.match(layout, /min-h-\[100svh\]/u)
    assert.match(layout, /pb-\[calc\(9rem\+env\(safe-area-inset-bottom\)\)\]/u)
    assert.match(layout, /px-3[\s\S]*sm:px-6/u)
    assert.match(mobileBar, /pb-\[max\(0\.75rem,env\(safe-area-inset-bottom\)\)\]/u)
    assert.match(mobileBar, /className="min-w-0 truncate"/u)
    assert.match(mobileBar, /h-11 w-11/u)
})

test("onboarding content scales down without changing the desktop composition", () => {
    assert.match(renderer, /text-2xl[\s\S]*sm:text-3xl/u)
    assert.match(renderer, /p-4 shadow-sm[\s\S]*sm:p-8/u)
    assert.match(form, /mt-6 space-y-5 sm:mt-8 sm:space-y-6/u)
    assert.match(form, /if \(preview\) return \{ status: "uploaded" as const, progress: 100 \}/u)
    assert.match(calendar, /gap-0\.5 sm:gap-1/u)
    assert.match(appointment, /h-12 w-full[\s\S]*sm:h-10 sm:text-sm/u)
})

test("long mobile actions and header popovers stay inside the viewport", () => {
    assert.match(blocks, /grid-cols-1 sm:grid-cols-\[auto_minmax\(0,1fr\)\]/u)
    assert.match(renderer, /onPreviewBack \|\| backHref/u)
    assert.match(renderer, /grid-cols-1 sm:grid-cols-\[auto_minmax\(0,1fr\)\]/u)
    assert.match(profile, /w-\[min\(18rem,calc\(100vw-1\.5rem\)\)\]/u)
    assert.match(testMenu, /w-\[min\(18rem,calc\(100vw-1\.5rem\)\)\]/u)
})

test("the standalone SMS opt-in keeps mobile type and controls readable", () => {
    assert.match(smsPage, /min-h-\[100svh\]/u)
    assert.match(smsPage, /text-2xl[\s\S]*sm:text-3xl/u)
    assert.match(smsPage, /px-3 py-5[\s\S]*sm:px-6 sm:py-12/u)
})
