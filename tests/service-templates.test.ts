import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"
import { SERVICE_TEMPLATES } from "../lib/onboarding/service-templates.ts"

const servicesUi = readFileSync("components/settings/ServiceCatalogue.tsx", "utf8")

test("the service template catalogue starts with the Meta Ads template", () => {
    assert.equal(SERVICE_TEMPLATES.length, 1)
    const [metaAds] = SERVICE_TEMPLATES
    assert.equal(metaAds.id, "meta-ads")
    assert.equal(metaAds.name, "Meta Ads")
    assert.ok(metaAds.description.length > 0)
    assert.equal(metaAds.serviceDefaults.thumbnailSrc, metaAds.thumbnail.src)
    assert.deepEqual(metaAds.setup, { kind: "connection", connectionKey: "meta_ads" })
    assert.equal(existsSync(`public${metaAds.thumbnail.src}`), true)
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

test("Services uses the shared responsive list anatomy", () => {
    assert.match(servicesUi, /<List ariaLabel="Services"/)
    assert.match(servicesUi, /<ListItem key=\{service\.id\}>/)
    assert.match(servicesUi, /<MobileListActionSurface/)
    assert.match(servicesUi, /<ListPrimaryRow>/)
    assert.match(servicesUi, /<ListTitle href=\{href\}/)
    assert.match(servicesUi, /<ListSecondaryRow>/)
    assert.match(servicesUi, /<ListTrailing>/)
    assert.match(servicesUi, /<ListActionMenu/)
    assert.doesNotMatch(servicesUi, />Service<\/span>/)
    assert.match(servicesUi, /sm:flex-row sm:items-end sm:justify-between/)
    assert.match(servicesUi, /w-full shrink-0[\s\S]*sm:w-auto/)
    assert.match(servicesUi, /settings\/services\/\$\{encodeURIComponent\(service\.id\)\}/)
})
