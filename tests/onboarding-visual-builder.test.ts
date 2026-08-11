import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
    createOnboardingStepV2,
    isOnboardingBookendV2,
    upgradeBookendToV2,
} from "../lib/onboarding/block-definition.ts"
import { isStableOnboardingId } from "../lib/onboarding/stable-id.ts"
import { normalizedBuilderCursor, visibleBuilderPresence, type BuilderPresence } from "../lib/onboarding/builder-presence.ts"
import { persistBuilderUpdate, refreshBuilderUpdates } from "../lib/onboarding/builder-sync-client.ts"

const builderPage = readFileSync("app/[workspaceSlug]/onboarding-builder/page.tsx", "utf8")
const builderUi = readFileSync("components/onboarding-builder/OnboardingBuilderWorkspace.tsx", "utf8")
const desktopBuilderGate = readFileSync("components/onboarding-builder/DesktopBuilderGate.tsx", "utf8")
const blockValidation = readFileSync("lib/onboarding/block-validation.ts", "utf8")
const blockLayout = readFileSync("lib/onboarding/block-layout.ts", "utf8")
const collaboration = readFileSync("components/onboarding-builder/useCollaborativeOnboardingDocument.ts", "utf8")
const visualActions = readFileSync("app/[workspaceSlug]/onboarding-builder/visual-actions.ts", "utf8")
const visualCanvas = readFileSync("components/onboarding-builder/VisualBuilderCanvas.tsx", "utf8")
const onboardingLayout = readFileSync("components/onboarding/OnboardingLayout.tsx", "utf8")
const mobileStepBar = readFileSync("components/onboarding/MobileStepBar.tsx", "utf8")
const runtimeBlocks = readFileSync("components/onboarding/OnboardingBlocks.tsx", "utf8")
const runtimePage = readFileSync("app/onboarding/session/[token]/page.tsx", "utf8")
const sessionSnapshot = readFileSync("lib/onboarding/session-snapshot.ts", "utf8")
const previewPage = readFileSync("app/onboarding/preview/[token]/page.tsx", "utf8")
const workspaceShell = readFileSync("components/workspace/WorkspaceTopBarClient.tsx", "utf8")
const onboardingSettings = readFileSync("components/settings/OnboardingSettings.tsx", "utf8")
const brandingSettings = readFileSync("components/settings/AgencyBrandingEditor.tsx", "utf8")
const configuration = readFileSync("lib/onboarding/configuration.ts", "utf8")
const migration = readFileSync("supabase/migrations/20260810110000_visual_onboarding_builder_v2.sql", "utf8")
const realtimeFixMigration = readFileSync("supabase/migrations/20260810223000_fix_onboarding_builder_realtime.sql", "utf8")
const moduleMigration = readFileSync("supabase/migrations/20260811010000_migrate_onboarding_bookends_to_modules.sql", "utf8")
const videoUploadFixMigration = readFileSync("supabase/migrations/20260811234500_fix_builder_video_uploads.sql", "utf8")
const updateRoute = readFileSync("app/api/workspaces/[workspaceSlug]/onboarding-builder/updates/route.ts", "utf8")

test("version-two steps use a protected Header and compatible mixed blocks", () => {
    const ordinary = createOnboardingStepV2()
    const bookend = createOnboardingStepV2({ bookend: true })
    assert.deepEqual(ordinary.blocks.map((block) => block.kind), ["header", "estimate", "form"])
    assert.deepEqual(bookend.blocks.map((block) => block.kind), ["header", "estimate"])
    assert.match(blockValidation, /Every step needs exactly one Header block/)
    assert.doesNotMatch(blockValidation, /Welcome and Completion steps cannot contain forms/)
    assert.match(blockValidation, /A step can contain only one Form block/)
    assert.match(blockValidation, /Every step needs exactly one Estimated time block/)
})

test("bookends migrate into ordinary mandatory modules with editable checklist blocks", () => {
    assert.match(moduleMigration, /system-welcome/)
    assert.match(moduleMigration, /system-completion/)
    assert.match(moduleMigration, /'mandatory', true/)
    assert.match(moduleMigration, /'placement', case when p_kind = 'welcome' then 'start' else 'end'/)
    assert.match(moduleMigration, /'kind', 'checklist'/)
    assert.match(builderUi, /setLeftTab\("modules"\)/)
    assert.match(builderUi, /Onboarding module names/)
    assert.match(runtimeBlocks, /block\.kind === "checklist"/)
})

test("a published V2 bookend mapped through the compatibility shape reopens safely", () => {
    const visualStep = createOnboardingStepV2({ bookend: true })
    const mappedBookend = {
        id: "11111111-1111-1111-1111-111111111111",
        revisionId: "22222222-2222-2222-2222-222222222222",
        kind: "welcome" as const,
        title: "Welcome",
        body: "Welcome body",
        videoUrl: "",
        videoPath: null,
        version: 2,
        status: "published" as const,
        lastEditedAt: null,
        lastEditedBy: null,
        schemaVersion: 2 as const,
        visualSteps: [visualStep],
    }
    assert.equal(isOnboardingBookendV2(mappedBookend), false)
    const upgraded = upgradeBookendToV2(mappedBookend)
    assert.equal(upgraded.steps[0].id, visualStep.id)
    assert.deepEqual(upgraded.steps[0].blocks.map((block) => block.kind), visualStep.blocks.map((block) => block.kind))
})

test("collaborative snapshots are upgraded before they replace the server definition", () => {
    assert.match(collaboration, /upgradeModuleToV2\(value as OnboardingModuleDefinitionV2\)/)
    assert.match(collaboration, /upgradeBookendToV2/)
    assert.match(collaboration, /fallback\.modules\.filter/)
})

test("publish validation rejects unsafe V2 definitions", () => {
    assert.match(blockValidation, /still uses an embedded video\. Open its Video block, upload the video file, then publish again/)
    assert.match(blockValidation, /The Header must remain the first block in every step/)
    assert.match(blockValidation, /duplicated.*block ID/u)
    assert.match(blockValidation, /two fields with the same internal ID/u)
    assert.match(blockValidation, /Button destinations must use HTTPS/)
    assert.match(blockLayout, /spacingBeforeClasses/)
    assert.match(blockLayout, /spacingAfterClasses/)
})

test("publish validation accepts deterministic legacy UUID-shaped IDs", () => {
    assert.equal(isStableOnboardingId("f427efbe-1e05-b363-677f-4be3974bc2f4"), true)
    assert.equal(isStableOnboardingId("not-a-stable-id"), false)
    assert.match(blockValidation, /damaged internal step data/u)
    assert.match(visualActions, /onboarding\.release\.rejected/u)
})

test("video upload preparation permits the empty Video block that it is about to fill", () => {
    assert.match(blockValidation, /allowPendingVideo/u)
    assert.match(visualActions, /normalizeVisualModule\(target\.definition, \{ allowPendingVideo: true \}\)/u)
    assert.match(visualActions, /return \{ ok: true, data:/u)
    assert.match(builderUi, /if \(!preparation\.ok\) throw new Error\(preparation\.error\)/u)
    assert.match(visualCanvas, /if \(!preparation\.ok\) throw new Error\(preparation\.error\)/u)
    assert.match(videoUploadFixMigration, /'header', 'estimate', 'form', 'checklist', 'video', 'button'/u)
    assert.match(videoUploadFixMigration, /Upload every video before publishing/u)
})

test("the visual Builder is standalone, responsive, collapsible, and composition-driven", () => {
    assert.match(builderPage, /requireWorkspace\(workspaceSlug, "admin"\)/)
    assert.match(builderPage, /h-dvh/)
    assert.match(builderPage, /visualEnabled/)
    assert.match(workspaceShell, /panel\.standalone/)
    assert.match(workspaceShell, /window\.open\(href, "_blank", "noopener,noreferrer"\)/)
    assert.match(onboardingSettings, /target="_blank"/)
    assert.match(builderUi, /function composeGroups\(document: VisualBuilderDocument\)/)
    assert.match(builderUi, /betelgeze:onboarding-builder:/)
    assert.match(builderUi, /Collapse left rail/)
    assert.match(builderUi, /Collapse right rail/)
    assert.match(visualCanvas, /max-w-\[430px\]/)
    assert.match(builderUi, /Calendar/)
    assert.match(builderUi, /Coming later/)
})

test("Builder defaults expose bookends and mandatory modules with expanded modules and collapsed steps", () => {
    assert.match(builderUi, /data\.mandatory\.draftModuleIds\.length \? data\.mandatory\.draftModuleIds : data\.mandatory\.publishedModuleIds/)
    assert.match(builderUi, /const \[collapsedGroups, setCollapsedGroups\] = useState<Set<string>>\(\(\) => new Set\(\)\)/)
    assert.match(builderUi, /groups\.flatMap\(\(group\) => group\.definition\.steps\.map/)
    assert.match(builderUi, /group\.kind === "bookend" \|\| visibleModuleIds\.has/)
})

test("module ordering is shared by Outline, Modules, persistence, and runtime composition", () => {
    assert.match(builderUi, /type: "module", moduleId: group\.definition\.id/)
    assert.match(builderUi, /function reorderModule\(moduleId: string, targetIndex: number\)/)
    assert.match(builderUi, /sortOrder: index \* 10/)
    assert.match(builderUi, /leftTab === "outline"[\s\S]*>Add step<\/button>/)
    assert.match(builderUi, /leftTab === "modules"[\s\S]*>Add module<\/button>/)
    assert.doesNotMatch(builderUi, />Position<select/)
    assert.doesNotMatch(builderUi, />New module<\/button>/)
    assert.match(collaboration, /restoredModules\.every\(\(module\) => typeof module\.sortOrder === "number"\)/)
})

test("published service composition is rebuilt from Builder-owned module links", () => {
    const publishedLoader = configuration.slice(configuration.indexOf("export async function loadPublishedOnboardingConfiguration"))
    assert.match(publishedLoader, /const storedServices/u)
    assert.match(publishedLoader, /moduleDefinition\.serviceIds\?\.includes\(service\.id\)/u)
    assert.match(publishedLoader, /preview, invoice preflight, and runtime compose/u)
})

test("Header and estimated time are independently inspectable blocks", () => {
    assert.match(builderUi, /Header block/)
    assert.match(builderUi, /block\.kind === "estimate"/)
    assert.match(builderUi, />Heading<input value=\{block\.title\}/)
    assert.match(builderUi, />Estimated time<input value=\{block\.estimatedTime\}/)
    assert.doesNotMatch(builderUi, /Step content stays editable directly on the canvas/)
    assert.match(visualCanvas, /target\.definition\.name/)
    assert.match(visualCanvas, /Estimated time:/)
})

test("Builder mobile simulation forces the client layout and Preview fills the viewport", () => {
    assert.match(visualCanvas, /forceMobile=\{viewport === "mobile"\}/)
    assert.match(visualCanvas, /embedded=\{!fullScreen\}/)
    assert.match(visualCanvas, /h-dvh w-full overflow-hidden/)
    assert.match(onboardingLayout, /forceMobile/)
    assert.match(onboardingLayout, /overflow-y-auto px-4 pb-36 pt-4/)
    assert.match(onboardingLayout, /embedded \|\| forceMobile/)
    assert.match(mobileStepBar, /forceVisible/)
    assert.match(builderUi, /data-builder-fullscreen-preview/)
    assert.match(builderUi, /Exit preview/)
    assert.match(builderUi, /event\.key === "Escape"/)
    assert.match(builderUi, /readOnly fullScreen/)
})

test("Builder chrome keeps mobile status, rail resizing, and header icons aligned", () => {
    assert.match(mobileStepBar, /data-mobile-preview-footer/)
    assert.match(mobileStepBar, /border-t border-black\/10 px-6 py-3 text-center text-sm font-medium/)
    assert.match(builderUi, /xl:grid-cols-\[3rem_minmax\(0,1fr\)_18rem\]/)
    assert.match(builderUi, /xl:grid-cols-\[3rem_minmax\(0,1fr\)_3rem\]/)
    assert.match(builderUi, /data-builder-left-rail-header/)
    assert.match(builderUi, /M9 5v14/)
    assert.match(builderUi, /M15 5v14/)
    assert.match(builderUi, /data-builder-viewport-toggle/)
    assert.match(builderUi, /inline-flex h-8 w-8 items-center justify-center rounded-md leading-none/)
})

test("structural authoring supports library drag, flexible cross-module moves, duplication, and phone restrictions", () => {
    assert.match(builderUi, /application\/x-betelgeze-builder-item/)
    assert.match(builderUi, /type: "library"/)
    assert.match(builderUi, /event\.metaKey \|\| event\.ctrlKey/)
    assert.match(builderUi, /linkedChangeSets/)
    assert.doesNotMatch(builderUi, /A step containing a Form cannot be moved into a bookend/)
    assert.match(builderUi, /Each bookend must retain at least one step/)
    assert.match(builderUi, /hidden md:flex/)
    assert.doesNotMatch(visualCanvas, /aria-label="Add a block"|aria-label="Insert a block here"/)
    assert.match(visualCanvas, /application\/x-betelgeze-block/)
    assert.match(builderUi, /draggable=\{collaboration\.editable\} disabled=\{!collaboration\.editable\}/)
})

test("outline drag distinguishes moving from numbered platform-modifier duplication", () => {
    assert.match(builderUi, /dataTransfer\.setDragImage/)
    assert.match(builderUi, /builderDragLabel/)
    assert.match(builderUi, /dragging\?\.key === stepKey && !dragging\.copy \? "opacity-0"/)
    assert.match(builderUi, /nextDuplicateName\(visualStepTitle\(sourceStep\)/)
    assert.match(builderUi, /nextDuplicateName\(blockName\(sourceBlock\)/)
    assert.match(builderUi, /nextDuplicateName\(source\.label/)
})

test("Builder is desktop-only while client mobile previews remain available", () => {
    assert.match(desktopBuilderGate, /matchMedia\("\(min-width: 768px\)"\)/)
    assert.match(desktopBuilderGate, /Onboarding Builder requires desktop/)
    assert.match(desktopBuilderGate, /Back to Betelgeze/)
    assert.match(visualCanvas, /forceMobile=\{viewport === "mobile"\}/)
})

test("client help is a fixed Builder item with live communication settings", () => {
    assert.match(builderUi, /HELP_BLOCK_ID/)
    assert.match(builderUi, /data-builder-help-inspector/)
    assert.match(builderUi, /Communication method/)
    assert.match(builderUi, /saveOnboardingHelpSettings/)
    assert.match(onboardingLayout, /data-builder-help-block/)
    assert.doesNotMatch(onboardingSettings, /function HelpSettings/)
})

test("the Builder outline nests fields, owns structure actions, and filters the shared roadmap", () => {
    assert.match(builderUi, /data-builder-outline-tree/)
    assert.match(builderUi, /type: "field"/)
    assert.match(builderUi, /Fields must stay inside their form/)
    assert.match(builderUi, /duplicateField/)
    assert.match(builderUi, /event\.metaKey \|\| event\.ctrlKey/)
    assert.match(builderUi, /window\.confirm/)
    assert.match(builderUi, /Delete .*This change can be undone/)
    assert.match(builderUi, /EyeIcon/)
    assert.match(builderUi, /visibleModuleIds/)
    assert.match(builderUi, /roadmapSteps/)
    assert.match(visualCanvas, /selectRoadmapStep/)
    assert.doesNotMatch(builderUi, /id="builder-move-target"/)
    assert.doesNotMatch(builderUi, />Library<\/button>/)
})

test("the Builder outline separates collapse, visibility, item identity, and deletion", () => {
    assert.match(builderUi, /function ChevronIcon/)
    assert.match(builderUi, /collapsedGroups/)
    assert.match(builderUi, /collapsedSteps/)
    assert.match(builderUi, /function OutlineItemIcon/)
    assert.match(builderUi, /bg-blue-500\/15 text-blue-300/)
    assert.match(builderUi, /bg-teal-500\/15 text-teal-300/)
    assert.match(builderUi, /bg-cyan-500\/15 text-cyan-300/)
    assert.match(builderUi, /bg-violet-500\/15 text-violet-300/)
    assert.match(builderUi, /bg-amber-500\/15 text-amber-300/)
    assert.match(builderUi, /text-xs font-bold/)
    assert.match(builderUi, /opacity-40 grayscale/)
    assert.doesNotMatch(builderUi, /⠿/)
    assert.doesNotMatch(builderUi, /ml-4 border-l border-neutral-800/)
})

test("Builder inspection separates field selection, behaviour, and cosmetic styles", () => {
    assert.match(builderUi, /data-builder-right-rail-header/)
    assert.match(builderUi, />Inspect<\/button>/)
    assert.match(builderUi, />Styles<\/button>/)
    assert.match(builderUi, /data-builder-field-inspector/)
    assert.match(builderUi, /data-builder-element-styles/)
    assert.match(builderUi, /data-builder-branding-styles/)
    assert.match(builderUi, /if \(!block \|\| field\) return <BrandingInspector/)
    assert.match(visualCanvas, /selectedBlockId === block\.id && !selectedFieldId/)
    assert.match(visualCanvas, /suppressHover=\{block\.kind === "form"\}/)
    assert.match(visualCanvas, /data-builder-field=\{field\.id\}/)
    assert.match(visualCanvas, /application\/x-betelgeze-field/)
    assert.doesNotMatch(visualCanvas, /Move field up|Move field down|aria-label="Field type"/)
    assert.doesNotMatch(visualCanvas, /Client must finish this video|Client must open this link/)
})

test("collaborative drafts use private Realtime, Yjs merging, presence, author undo, and fail-closed offline editing", () => {
    assert.match(collaboration, /from "yjs"/)
    assert.match(collaboration, /new Y\.UndoManager/)
    assert.match(collaboration, /KEYED_ARRAY_KIND/)
    assert.match(collaboration, /reconcileKeyedArray/)
    assert.match(collaboration, /retryUpdateRef/)
    assert.match(collaboration, /batch\.updateId/)
    assert.match(collaboration, /private: true/)
    assert.match(collaboration, /supabase\.auth\.getSession\(\)/)
    assert.match(collaboration, /supabase\.realtime\.setAuth\(accessToken\)/)
    assert.match(collaboration, /event: "document-update"/)
    assert.match(collaboration, /channel\.track/)
    assert.equal(collaboration.match(/channel\.track/g)?.length, 1)
    assert.match(collaboration, /event: "collaborator-activity"/)
    assert.match(collaboration, /broadcast: \{ self: false, ack: false \}/)
    assert.match(collaboration, /activityTimerRef/)
    assert.match(collaboration, /2_500/)
    assert.match(collaboration, /8_000/)
    assert.match(collaboration, /}, 80\)/)
    assert.match(collaboration, /refreshRealtimeAuth/)
    assert.match(collaboration, /setRealtimeState\("connected"\)/)
    assert.match(collaboration, /refreshFromServer/)
    assert.match(collaboration, /Offline — editing paused|offline/)
    assert.match(collaboration, /editable: \["synced", "syncing"\]\.includes\(syncState\)/)
    assert.doesNotMatch(collaboration, /editable: realtimeState === "connected"/)
    assert.match(collaboration, /connectionTimeout/)
    assert.match(builderUi, /label: "Saved"/)
    assert.match(builderUi, /label: "Saving…"/)
    assert.match(builderUi, /label: "Save failed"/)
    assert.doesNotMatch(builderUi, /Presence unavailable|Connecting presence|Live ·/)
    assert.match(builderUi, /<Avatar src=\{person\.avatarSrc\}/)
    assert.match(builderUi, /grayscale opacity-40/)
    assert.match(builderUi, /Builder collaborators/)
    assert.match(configuration, /loadBuilderCollaborators/)
    assert.match(configuration, /\.in\("role", \["owner", "admin"\]\)/)
    assert.match(configuration, /profileAvatarUrl\(name, profile\.avatar_path\)/)
    assert.match(migration, /onboarding_builder_updates/)
    assert.match(migration, /append_onboarding_builder_update/)
    assert.match(migration, /on conflict \(workspace_id, update_id\) do nothing/)
    assert.match(migration, /if v_sequence is null then/)
    assert.match(migration, /floor\(extract\(epoch from now\(\)\) \/ 900\)/)
    assert.match(migration, /realtime\.topic\(\) like 'onboarding-builder:%'/)
    assert.match(migration, /public\.is_workspace_member\(workspace_id, array\['owner','admin'\]\)/)
    assert.doesNotMatch(migration, /public\.is_workspace_role/)
    assert.match(realtimeFixMigration, /can_access_onboarding_builder_realtime/)
    assert.match(realtimeFixMigration, /security definer/)
    assert.match(realtimeFixMigration, /drop policy if exists/)
})

test("Builder autosave uses a quiet route request and collaborative catch-up", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
        requests.push({ url: String(input), init })
        if (init?.method === "POST") return Response.json({ ok: true, data: { sequence: 7, version: 3 } })
        return Response.json({ ok: true, data: { version: 3, snapshotBase64: null, snapshotSequence: 0, updates: [] } })
    }) as typeof fetch

    const saved = await persistBuilderUpdate(fetcher, "scaylup", { updateId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:1", updateBase64: "AQ==", definitionIds: ["module:one"] })
    const refreshed = await refreshBuilderUpdates(fetcher, "scaylup", 7)

    assert.equal(saved.ok, true)
    assert.equal(refreshed.ok, true)
    assert.equal(requests[0].url, "/api/workspaces/scaylup/onboarding-builder/updates")
    assert.equal(requests[0].init?.method, "POST")
    assert.equal(new Headers(requests[0].init?.headers).has("Next-Action"), false)
    assert.equal(requests[1].url, "/api/workspaces/scaylup/onboarding-builder/updates?after=7")
    assert.match(updateRoute, /loadVisualBuilderUpdates/)
    assert.match(updateRoute, /Cache-Control.*no-store/)
})

test("presence keeps distinct browser sessions and normalizes cursor coordinates", () => {
    const presence = (clientId: string, userId: string): BuilderPresence => ({ clientId, userId, name: userId, avatarSrc: null, color: "#fff", selection: null, cursor: null })
    const visible = visibleBuilderPresence({ first: [presence("client-a", "user-1")], second: [presence("client-b", "user-1")], third: [presence("client-c", "user-2")] }, "client-a")
    assert.deepEqual(visible.map((item) => item.clientId), ["client-b", "client-c"])
    assert.deepEqual(normalizedBuilderCursor(500, 250, 1_000, 500), { xRatio: 0.5, yRatio: 0.5 })
    assert.deepEqual(normalizedBuilderCursor(2_000, -5, 1_000, 500), { xRatio: 1, yRatio: 0 })
})

test("one release transaction publishes definitions, style, migrations, notices, and Activity", () => {
    assert.match(visualActions, /publish_visual_onboarding_release/)
    assert.match(visualActions, /p_expected_document_version/)
    assert.match(migration, /for update/)
    assert.match(migration, /save_onboarding_module_draft/)
    assert.match(migration, /publish_onboarding_module/)
    assert.match(migration, /publish_onboarding_bookend/)
    assert.match(migration, /publish_onboarding_theme_draft/)
    assert.match(migration, /onboarding_release_notices/)
    assert.match(migration, /consolidated_release_id/)
    assert.match(migration, /record_workspace_admin_activity/)
    assert.match(migration, /The Builder changed while this release was being reviewed/)
    assert.match(migration, /Completion cannot be published while an active client has already started it/)
    assert.match(builderUi, /setPublishedBaseline\(releaseFingerprint\(collaboration\.document\)\)/)
    assert.match(builderUi, /setPublishedVersion\(version\)/)
    assert.match(builderUi, /All onboarding changes are published/)
    assert.doesNotMatch(builderUi, /setTimeout\(\(\) => window\.location\.reload\(\), 650\)/)
    assert.match(collaboration, /initialDocument/)
    assert.match(builderUi, /data\.collaboration\.version === data\.collaboration\.publishedVersion/)
})

test("runtime requirements persist by stable session block and gate atomic step completion", () => {
    assert.match(migration, /relationship_onboarding_session_blocks/)
    assert.match(migration, /onboarding_block_requirements/)
    assert.match(migration, /satisfy_onboarding_block_requirement/)
    assert.match(migration, /Complete the required video or link before continuing/)
    assert.match(runtimeBlocks, /onEnded=\{\(\) => void satisfy\(block, "video_finished"\)\}/)
    assert.match(runtimeBlocks, /onClick=\{\(\) => void satisfy\(block, "button_opened"\)\}/)
    assert.match(runtimeBlocks, /disabled=\{unsatisfied\.length > 0\}/)
    assert.match(runtimePage, /satisfiedBlockIds/)
    assert.match(runtimePage, /Boolean\(currentStep\.blocks\?\.length\)/)
    assert.match(sessionSnapshot, /\["header", "estimate", "form", "checklist", "video", "button"\]/)
})

test("frozen visual previews and Settings style share the release pipeline without live draft leakage", () => {
    assert.match(migration, /onboarding_visual_preview_tokens/)
    assert.match(migration, /expires_at timestamptz not null/)
    assert.match(visualActions, /Date\.now\(\) \+ 24 \* 60 \* 60 \* 1_000/)
    assert.match(migration, /p_expires_at > now\(\) \+ interval '24 hours 5 minutes'/)
    assert.match(previewPage, /onboarding_visual_preview_tokens/)
    assert.match(previewPage, /OnboardingSessionRenderer/)
    assert.match(previewPage, /preview/)
    assert.match(brandingSettings, /Unpublished style draft/)
    assert.match(brandingSettings, /publishVisualThemeDraft/)
    assert.match(builderUi, /Colour palette/)
    assert.match(builderUi, /Publishing colours immediately updates active and completed onboarding sessions/)
})
