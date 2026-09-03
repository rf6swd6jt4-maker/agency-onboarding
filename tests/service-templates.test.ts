import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"
import { SERVICE_TEMPLATES } from "../lib/onboarding/service-templates.ts"

const servicesUi = readFileSync("components/settings/ServiceCatalogue.tsx", "utf8")

test("the service template catalogue starts with the Meta Ads template", () => {
    assert.equal(SERVICE_TEMPLATES.length, 2)
    const [metaAds, appointmentSetting] = SERVICE_TEMPLATES
    assert.equal(metaAds.id, "meta-ads")
    assert.equal(metaAds.name, "Meta Ads")
    assert.ok(metaAds.description.length > 0)
    assert.equal(metaAds.serviceDefaults.thumbnailSrc, metaAds.thumbnail.src)
    assert.deepEqual(metaAds.setup, { kind: "connection", connectionKey: "meta_ads" })
    assert.deepEqual(metaAds.capabilities, ["onboarding.manage", "fulfilment.manage"])
    assert.deepEqual(metaAds.onboardingBlocks, [{ kind: "connection", label: "Facebook connection" }])
    assert.equal(existsSync(`public${metaAds.thumbnail.src}`), true)
    assert.equal(appointmentSetting.id, "appointment-setting")
    assert.equal(appointmentSetting.name, "Appointment Setting")
    assert.equal(appointmentSetting.thumbnail.src, "/service-templates/appointment-setting.png")
    assert.equal(appointmentSetting.serviceDefaults.thumbnailSrc, appointmentSetting.thumbnail.src)
    assert.deepEqual(appointmentSetting.setup, { kind: "none" })
    assert.deepEqual(appointmentSetting.capabilities, ["onboarding.manage", "fulfilment.manage", "appointment_setting.manage"])
    assert.deepEqual(appointmentSetting.onboardingBlocks.map((block) => block.kind), ["appointment_medium", "appointment_fields"])
    assert.equal(existsSync(`public${appointmentSetting.thumbnail.src}`), true)
})

test("New service opens templates and the first card reaches the preserved custom editor", () => {
    assert.match(servicesUi, />Service Templates</)
    assert.match(servicesUi, />Add your own</)
    assert.match(servicesUi, />Create a custom service from scratch\.</)
    assert.match(servicesUi, /SERVICE_TEMPLATES\.map/)
    assert.match(servicesUi, /onSelectTemplate\(template\)/)
    assert.match(servicesUi, /onClick=\{\(\) => setTemplatesOpen\(true\)\}/)
    assert.doesNotMatch(servicesUi, /onClick=\{\(\) => setSelectedId\("new"\)\}/)
    assert.match(servicesUi, /onCreateCustom=\{\(\) => \{ setTemplatesOpen\(false\); setSelectedId\("new"\) \}\}/)
    assert.match(servicesUi, /initialServiceId && initialServiceId !== "new"/)
    assert.match(servicesUi, /selectedId === "new" \? blankService\(\)/)
    assert.match(servicesUi, /blankService\(selectedTemplate\)/)
    assert.match(servicesUi, /"Create service"/)
})

test("Services uses a compact Settings option list with popup editing", () => {
    assert.match(servicesUi, /<ServiceStatusSummary services=\{services\}/)
    assert.match(servicesUi, /label="Active" tone="green"/)
    assert.match(servicesUi, /label="Retired" tone="yellow"/)
    assert.match(servicesUi, /label="Archived" tone="grey"/)
    assert.match(servicesUi, /role="list" aria-label="Services"/)
    assert.match(servicesUi, /role="listitem" key=\{service\.id\}/)
    assert.match(servicesUi, /onClick=\{\(\) => setSelectedId\(service\.id\)\}/)
    assert.match(servicesUi, /aria-label=\{`Edit \$\{service\.name\}`\}/)
    assert.match(servicesUi, /createPortal\(<ServiceEditor/)
    assert.match(servicesUi, /fixed inset-0[\s\S]*items-center justify-center/)
    assert.doesNotMatch(servicesUi, /settings\/services\/\$\{encodeURIComponent\(service\.id\)\}/)
    assert.doesNotMatch(servicesUi, /<List|<MobileListActionSurface|<ListActionMenu/)
})

test("Services owns the centred Staff permissions editor", () => {
    assert.match(servicesUi, />Staff permissions</)
    assert.match(servicesUi, /STAFF_SERVICE_PERMISSION_OPTIONS\.map/)
    assert.match(servicesUi, /Permissions from multiple assigned services add together\./)
    assert.match(servicesUi, /saveOnboardingServiceStaffPermissions/)
    assert.match(servicesUi, /createPortal\(<ServiceStaffPermissionsEditor/)
    assert.match(servicesUi, /fixed inset-0[\s\S]*items-center justify-center/)
})
