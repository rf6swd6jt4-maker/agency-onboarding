import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { visibleWorkspacePresence, workspacePresenceTopic, type WorkspacePresenceMember } from "../lib/workspace-presence.ts"

function member(clientId: string, userId: string, name: string): WorkspacePresenceMember {
    return { clientId, userId, name, avatarSrc: null, activePath: null }
}

test("workspace presence is workspace-scoped and deduplicates browser sessions by user", () => {
    assert.equal(workspacePresenceTopic("scaylup"), "workspace-presence:scaylup")
    assert.deepEqual(visibleWorkspacePresence({
        first: [member("current", "user-1", "Current")],
        second: [member("a", "user-2", "Zoe"), member("b", "user-2", "Zoe")],
        third: [member("c", "user-3", "Alex")],
    }, "user-1").map((person) => person.userId), ["user-3", "user-2"])
})

test("workspace mutations save in the background while non-workspace forms retain the existing action path", async () => {
    const [loading, bridge, shell, settings, profile, activityRoute] = await Promise.all([
        readFile("components/GlobalLoadingOverlay.tsx", "utf8"),
        readFile("components/workspace/WorkspaceTabBridge.tsx", "utf8"),
        readFile("components/workspace/WorkspaceTopBarClient.tsx", "utf8"),
        readFile("app/[workspaceSlug]/settings/page.tsx", "utf8"),
        readFile("components/account/ProfileSettings.tsx", "utf8"),
        readFile("app/api/workspaces/[workspaceSlug]/activity/mutations/route.ts", "utf8"),
    ])
    assert.match(loading, /workspaceFrame[\s\S]*betelgeze:workspace-mutation-start/)
    assert.match(loading, /activity\/mutations/)
    assert.match(bridge, /type: "mutation-end"/)
    assert.match(shell, /WorkspacePresenceAvatars members=\{activeWorkspaceUsers\}/)
    assert.match(shell, /WorkspaceMutationStatus/)
    assert.match(settings, /<WorkspaceAutosaveForm action=\{updateWorkspaceName/)
    assert.match(profile, /Save profile/)
    assert.match(activityRoute, /metricClassification: "operational"/)
    assert.match(activityRoute, /background = input\?\.background === true/)
})

test("private Realtime policy limits shell presence to members of the named active workspace", async () => {
    const migration = await readFile("supabase/migrations/20260815120000_workspace_presence_realtime.sql", "utf8")
    assert.match(migration, /security definer/)
    assert.match(migration, /workspace-presence:/)
    assert.match(migration, /membership\.user_id = auth\.uid\(\)/)
    assert.match(migration, /workspace\.status = 'active'/)
    assert.match(migration, /on realtime\.messages for select to authenticated/)
    assert.match(migration, /on realtime\.messages for insert to authenticated/)
})
