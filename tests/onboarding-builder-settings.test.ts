import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { defaultOnboardingModuleDefinition, isAllowedOnboardingVideoUrl, isScopedBuilderVideoPath, normalizeModuleDefinition } from "../lib/onboarding/configuration-validation.ts"
import { colourContrastRatio, resolveOnboardingTheme } from "../lib/onboarding/theme.ts"
import { bookendToRenderStep, configuredStepToRenderStep } from "../lib/onboarding/render-model.ts"
import { modulePublishDiff } from "../lib/onboarding/publish-impact.ts"
import type { OnboardingBookendDefinition, OnboardingModuleDefinition } from "../lib/onboarding/configuration-types.ts"

const settingsPage = readFileSync("app/[workspaceSlug]/settings/page.tsx", "utf8")
const builderPage = readFileSync("app/[workspaceSlug]/onboarding-builder/page.tsx", "utf8")
const builderActions = readFileSync("app/[workspaceSlug]/onboarding-builder/actions.ts", "utf8")
const serviceActions = readFileSync("app/[workspaceSlug]/settings/service-actions.ts", "utf8")
const onboardingActions = readFileSync("app/[workspaceSlug]/settings/onboarding-actions.ts", "utf8")
const brandingActions = readFileSync("app/[workspaceSlug]/settings/branding-actions.ts", "utf8")
const visualActions = readFileSync("app/[workspaceSlug]/onboarding-builder/visual-actions.ts", "utf8")
const searchRoute = readFileSync("app/api/workspaces/[workspaceSlug]/search/route.ts", "utf8")
const servicesUi = readFileSync("components/settings/ServiceCatalogue.tsx", "utf8")
const onboardingUi = readFileSync("components/settings/OnboardingSettings.tsx", "utf8")
const builderWindowControls = readFileSync("components/onboarding-builder/OnboardingBuilderWindowControls.tsx", "utf8")
const builderWindowProtocol = readFileSync("lib/onboarding-builder-window.ts", "utf8")
const brandingUi = readFileSync("components/settings/AgencyBrandingEditor.tsx", "utf8")
const colourStyleUi = readFileSync("components/settings/ColourStyleEditor.tsx", "utf8")
const builderUi = readFileSync("components/onboarding-builder/OnboardingBuilderWorkspace.tsx", "utf8")
const workspaceShell = readFileSync("components/workspace/WorkspaceTopBarClient.tsx", "utf8")
const workspaceBridge = readFileSync("components/workspace/WorkspaceTabBridge.tsx", "utf8")
const sharedRenderer = readFileSync("components/onboarding/OnboardingSessionRenderer.tsx", "utf8")
const configurationLoader = readFileSync("lib/onboarding/configuration.ts", "utf8")
const configurationActions = readFileSync("lib/onboarding/configuration-actions.ts", "utf8")
const onboardingUploads = readFileSync("lib/onboarding/uploads.ts", "utf8")
const connectionsUi = readFileSync("components/admin/WorkspaceConnections.tsx", "utf8")
const domainUi = readFileSync("components/admin/WorkspaceOnboardingDomain.tsx", "utf8")
const invitationUi = readFileSync("components/admin/WorkspaceInvitationForm.tsx", "utf8")

test("new modules begin with one form step and one optional short-text field", () => {
    const definition = defaultOnboardingModuleDefinition()
    assert.equal(definition.steps.length, 1)
    assert.equal(definition.steps[0].kind, "form")
    assert.equal(definition.steps[0].fields.length, 1)
    assert.equal(definition.steps[0].fields[0].type, "text")
    assert.equal(definition.steps[0].fields[0].required, false)
})

test("video validation accepts supported providers and direct HTTPS video files", () => {
    assert.equal(isAllowedOnboardingVideoUrl("https://www.loom.com/share/abc"), true)
    assert.equal(isAllowedOnboardingVideoUrl("https://youtu.be/abc"), true)
    assert.equal(isAllowedOnboardingVideoUrl("https://vimeo.com/123"), true)
    assert.equal(isAllowedOnboardingVideoUrl("https://cdn.example.com/welcome.mp4"), true)
    assert.equal(isAllowedOnboardingVideoUrl("http://example.com/video.mp4"), false)
    assert.equal(isAllowedOnboardingVideoUrl("https://example.com/page"), false)
})

test("Builder upload paths stay inside the owning workspace module draft", () => {
    const workspaceId = "11111111-1111-4111-8111-111111111111"
    const moduleId = "22222222-2222-4222-8222-222222222222"
    const revisionId = "33333333-3333-4333-8333-333333333333"
    const validPath = `${workspaceId}/onboarding-builder/${moduleId}/${revisionId}/44444444-4444-4444-8444-444444444444-video.mp4`
    assert.equal(isScopedBuilderVideoPath(validPath, workspaceId, moduleId, revisionId), true)
    assert.equal(isScopedBuilderVideoPath(validPath.replace(workspaceId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), workspaceId, moduleId, revisionId), false)
    assert.equal(isScopedBuilderVideoPath(`${workspaceId}/onboarding-builder/${moduleId}/${revisionId}/../foreign.mp4`, workspaceId, moduleId, revisionId), false)
    assert.equal(isScopedBuilderVideoPath(validPath, workspaceId, moduleId, null), false)
    assert.match(builderActions, /\.eq\("status", "draft"\)/)
    assert.match(builderActions, /Bookend videos must use a supported HTTPS URL/)
    assert.match(onboardingUploads, /!Number\.isSafeInteger\(file\.size\) \|\| file\.size <= 0/)
    assert.match(onboardingUploads, /file\.size > MAX_ONBOARDING_UPLOAD_SIZE/)
})

test("file fields normalize to optional, multiple, any-type defaults", () => {
    const definition = defaultOnboardingModuleDefinition()
    const field = definition.steps[0].fields[0] as unknown as Record<string, unknown>
    field.type = "file"
    delete field.multiple
    const normalized = normalizeModuleDefinition(definition)
    assert.equal(normalized.ok, true)
    if (!normalized.ok) return
    assert.equal(normalized.definition.steps[0].fields[0].required, false)
    assert.equal(normalized.definition.steps[0].fields[0].accept, "any")
    assert.equal(normalized.definition.steps[0].fields[0].multiple, true)
})

test("the shared render-model mapper addresses steps and fields by stable UUID", () => {
    const definition: OnboardingModuleDefinition = {
        id: "11111111-1111-4111-8111-111111111111",
        revisionId: "22222222-2222-4222-8222-222222222222",
        code: "business-basics",
        name: "Business basics",
        description: "",
        isTest: false,
        status: "draft",
        version: 1,
        lastEditedAt: null,
        lastEditedBy: null,
        steps: [{
            id: "33333333-3333-4333-8333-333333333333",
            key: "legacy-step-key",
            kind: "form",
            title: "Your business",
            description: "Tell us about it.",
            estimatedTime: "2 minutes",
            why: "So we can prepare.",
            videoUrl: "",
            videoPath: null,
            fields: [{
                id: "44444444-4444-4444-8444-444444444444",
                key: "legacy-field-key",
                label: "Business name",
                type: "text",
                required: true,
                helpText: "",
                placeholder: "",
                accept: "any",
                multiple: false,
            }],
        }],
    }
    const renderStep = configuredStepToRenderStep(definition, definition.steps[0])
    assert.equal(renderStep.key, definition.steps[0].id)
    assert.equal(renderStep.form?.key, definition.steps[0].id)
    assert.equal(renderStep.form?.fields[0].name, definition.steps[0].fields[0].id)
})

test("completion bookends retain optional video in the shared renderer", () => {
    const completion: OnboardingBookendDefinition = {
        id: "55555555-5555-4555-8555-555555555555",
        revisionId: "66666666-6666-4666-8666-666666666666",
        kind: "completion",
        title: "All done",
        body: "We will be in touch.",
        videoUrl: "https://cdn.example.com/completion.mp4",
        videoPath: null,
        resolvedVideoUrl: null,
        version: 1,
        status: "published",
        lastEditedAt: null,
        lastEditedBy: null,
    }
    const renderStep = bookendToRenderStep(completion)
    assert.equal(renderStep.kind, "final")
    assert.equal(renderStep.videoUrl, completion.videoUrl)
    assert.match(sharedRenderer, /\(step\.kind === "video" \|\| isFinalStep\) && step\.videoUrl/)
})

test("publication impact follows unsaved local step and field edits", () => {
    const published: OnboardingModuleDefinition = {
        id: "88888888-8888-4888-8888-888888888888",
        revisionId: "99999999-9999-4999-8999-999999999999",
        code: "impact-module",
        status: "published",
        version: 2,
        lastEditedAt: null,
        lastEditedBy: null,
        ...defaultOnboardingModuleDefinition(),
    }
    const draft = structuredClone(published)
    draft.status = "draft"
    draft.steps.push({ ...structuredClone(draft.steps[0]), id: "77777777-7777-4777-8777-777777777777", key: "new-step", title: "New step", fields: [] })
    const impact = modulePublishDiff(draft, published)
    assert.equal(impact.addedSteps, 1)
    assert.equal(impact.draftStepCount, 2)
    assert.equal(impact.publishedStepCount, 1)
})

test("theme resolution retains hidden assigned swatches", () => {
    const theme = {
        id: "theme",
        swatches: [
            { id: "hidden", name: "Legacy primary", hex: "#123456", hidden: true },
            { id: "visible", name: "Surface", hex: "#FFFFFF", hidden: false },
        ],
        assignments: { primary: "hidden", accent: "hidden", pageBackground: "visible", surface: "visible", text: "hidden", mutedText: "hidden" },
        updatedAt: null,
        updatedBy: null,
    }
    assert.equal(resolveOnboardingTheme(theme).primary, "#123456")
    assert.ok(colourContrastRatio("#000000", "#FFFFFF") > 20)
})

test("Settings renders real Services, Onboarding, and Agency Branding authoring surfaces", () => {
    assert.match(settingsPage, /loadOnboardingSettingsPageData/)
    assert.match(settingsPage, /<ServiceCatalogue/)
    assert.match(settingsPage, /<OnboardingSettings/)
    assert.match(settingsPage, /<AgencyBrandingEditor/)
    assert.match(settingsPage, /id="onboarding-domain"/)
})

test("Settings keeps every category inside the mobile content track", () => {
    assert.match(settingsPage, /overflow-x-clip/)
    assert.match(settingsPage, /id="workspace-settings-scroll" className="min-w-0 max-w-full/)
    assert.match(brandingUi, /min-w-0 max-w-full space-y-5/)
    assert.match(connectionsUi, /grid min-w-0 max-w-full gap-4/)
    assert.match(connectionsUi, /break-all text-sm text-neutral-300/)
    assert.match(invitationUi, /sm:grid-cols-\[minmax\(0,1fr\)_auto_auto\]/)
    assert.doesNotMatch(domainUi, /overflow-x-auto/)
    assert.match(domainUi, /sm:grid-cols-\[3rem_minmax\(0,1fr\)_minmax\(0,1fr\)\]/)
})

test("Agency Branding edits semantic colours in a compact centred modal", () => {
    assert.match(brandingUi, /Client colour roles/)
    assert.match(brandingUi, /createPortal/)
    assert.match(brandingUi, /backdrop-blur-sm/)
    assert.match(brandingUi, /max-h-\[min\(92dvh,38rem\)\]/)
    assert.match(brandingUi, /<ColourStyleEditor/)
    assert.match(colourStyleUi, />Styles</)
    assert.match(colourStyleUi, /New colour style/)
    assert.match(colourStyleUi, /Save style/)
    assert.match(colourStyleUi, /linear-gradient\(90deg, #FF0000/)
    assert.match(colourStyleUi, /relative flex shrink-0 items-center/)
    assert.doesNotMatch(brandingUi, /Live colour preview/)
})

test("Builder keeps private server access and renders the visual workspace", () => {
    assert.match(builderPage, /requireWorkspace\(workspaceSlug, "admin"\)/)
    assert.match(builderPage, /loadOnboardingBuilderData/)
    assert.match(builderPage, /<OnboardingBuilderWorkspace/)
    assert.match(builderUi, /Outline/)
    assert.match(builderUi, /Blocks/)
    assert.match(builderUi, /Desktop/)
    assert.match(builderUi, /Mobile/)
    assert.match(builderUi, />\{preview \? "Edit" : "Preview"\}</)
    assert.match(builderUi, /Future \+ all affected active sessions/)
    assert.match(builderUi, /Global Style/)
    assert.match(builderUi, /publishVisualOnboardingRelease/)
    assert.match(builderUi, /rotateVisualOnboardingPreview/)
    assert.match(configurationLoader, /relationship_onboarding_session_modules/)
    assert.match(configurationLoader, /visualModules/)
})

test("Builder opens outside the workspace shell and leaves a lightweight tab placeholder", () => {
    assert.match(builderPage, /Onboarding Builder open in another tab/)
    assert.match(builderPage, /<WorkspaceTabBridge/)
    assert.ok(builderPage.indexOf("if (tabId)") < builderPage.indexOf("loadOnboardingBuilderData(workspace.id"))
    assert.match(workspaceShell, /openOnboardingBuilderWindow\(href, workspace\.slug\)\s+navigateActiveTab\(href\)/)
    assert.match(workspaceBridge, /isWorkspaceOnboardingBuilderUrl\(nextUrl/)
    assert.match(workspaceBridge, /openOnboardingBuilderWindow\(nextUrl, workspaceSlug\)/)
    assert.match(workspaceBridge, /window\.location\.assign\(workspaceTabFrameUrl\(nextUrl, tabId/)
    assert.match(builderWindowControls, /disabled:bg-neutral-700|bg-neutral-700/)
    assert.match(builderWindowControls, /Onboarding Builder is already open/)
    assert.match(builderWindowProtocol, /window\.opener\.top/)
    assert.match(builderWindowProtocol, /window\.close\(\)/)
    assert.match(workspaceShell, /message\.type !== "return"/)
})

test("record navigation opens or reuses internal workspace tabs without changing shell navigation", () => {
    assert.match(workspaceBridge, /workspaceRouteIsRecordDetail\(nextUrl/)
    assert.match(workspaceBridge, /type: "open-tab"/)
    assert.match(workspaceShell, /message\.type === "open-tab"/)
    assert.match(workspaceShell, /currentTabs\.find\(\(tab\) => tab\.url === url\)/)
    assert.match(workspaceShell, /currentTabs\.length >= 8/)
    assert.match(workspaceShell, /navigateWorkspaceDestination\(item\.href\); closeSidebarAfterNavigation\(\)/)
    assert.match(workspaceShell, /navigateSearchDestination\(item\.href\)/)
})

test("all configuration Server Actions re-authorize admins and use transactional RPCs", () => {
    for (const source of [builderActions, serviceActions, onboardingActions, brandingActions]) assert.match(source, /requireWorkspace\(slug, "admin"\)/)
    assert.match(builderActions, /save_onboarding_module_draft/)
    assert.match(builderActions, /publish_onboarding_module/)
    assert.match(builderActions, /record_onboarding_preview_revoked/)
    assert.doesNotMatch(builderActions, /from\("onboarding_preview_tokens"\)\.update/)
    assert.match(serviceActions, /save_onboarding_service_revision/)
    assert.match(onboardingActions, /publish_onboarding_configuration/)
    assert.match(onboardingActions, /save_published_onboarding_help/)
    assert.match(brandingActions, /save_onboarding_theme_draft/)
    assert.match(visualActions, /publish_visual_onboarding_release/)
})

test("only the Scaylup workspace may retain the legacy onboarding seed", () => {
    assert.match(configurationLoader, /ensure_workspace_onboarding_seeded/)
    assert.match(configurationLoader, /raw\.workspaceSlug !== "scaylup"/)
    assert.match(configurationLoader, /useLegacyFallback = !raw\.schemaReady \|\| raw\.workspaceSlug === "scaylup"/)
    assert.match(configurationLoader, /p_mandatory_module_codes: \["general-info"\]/)
    assert.match(configurationLoader, /return queryRawConfiguration\(workspaceId\)/)
    assert.match(configurationLoader, /definition\.isTest/)
})

test("private search includes dynamic services and modules without weakening the Staff gate", () => {
    assert.match(searchRoute, /if \(canAccessPrivatePanels\)[\s\S]*from\("onboarding_modules"\)/)
    assert.match(searchRoute, /from\("onboarding_services"\)/)
    assert.match(searchRoute, /onboarding-builder\?module=/)
    assert.match(searchRoute, /settings\?service=/)
    assert.match(searchRoute, /revision_number, status, definition/)
    assert.match(searchRoute, /admin\/activity\/\$\{event\.id\}/)
    assert.doesNotMatch(searchRoute, /event\.source_href \?\? `\/\$\{workspace\.slug\}\/admin\/activity`/)
})

test("Settings and Builder authoring controls are not forced into canonical List", () => {
    for (const source of [servicesUi, onboardingUi, brandingUi, builderUi]) assert.doesNotMatch(source, /components\/list\/List/)
    assert.match(servicesUi, /SquarePill tone="yellow">Test/)
    assert.match(onboardingUi, /OnboardingBuilderLauncher/)
    assert.match(builderWindowControls, /Open Onboarding Builder/)
})

test("module configuration has moved out of Settings and into the Builder", () => {
    assert.doesNotMatch(onboardingUi, /MandatoryModules/)
    assert.doesNotMatch(onboardingUi, /Session bookends/)
    assert.match(builderUi, /setLeftTab\("modules"\)/)
    assert.match(builderUi, /Linked services/)
})

test("service authoring explains priority, portals an accessible full-shell dialog, and permits reviewed Retired reactivation", () => {
    assert.match(servicesUi, /Higher numbers compose earlier in onboarding/)
    assert.match(servicesUi, /createPortal/)
    assert.match(servicesUi, /window\.parent\.document\.body/)
    assert.match(servicesUi, /role="dialog"/)
    assert.match(servicesUi, /aria-modal="true"/)
    assert.match(servicesUi, /event\.key === "Escape"/)
    assert.match(servicesUi, /service\.state === "active" && !dirty/)
    assert.match(servicesUi, /service\.state === "retired" \? "Save and reactivate"/)
})

test("configuration actions keep business rules truthful while sanitizing and routing platform failures", () => {
    assert.match(configurationActions, /CONFIGURATION_BUSINESS_ERROR_CODES/)
    assert.match(configurationActions, /outcome: "rejected"/)
    assert.match(configurationActions, /reportPlatformFailure/)
    assert.match(configurationActions, /error_code: error\.code/)
    assert.doesNotMatch(configurationActions, /return \{ ok: false, error: error\.message \}/)
})
