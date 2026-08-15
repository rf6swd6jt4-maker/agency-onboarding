import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("workspace teams and native conversations have scoped durable storage", async () => {
    const migration = await readFile("supabase/migrations/20260815143000_workspace_teams_native_chat.sql", "utf8")
    for (const table of [
        "workspace_teams",
        "workspace_team_members",
        "workspace_team_service_responsibilities",
        "workspace_native_conversations",
        "workspace_native_conversation_participants",
        "workspace_native_messages",
        "workspace_native_reactions",
        "workspace_native_read_cursors",
    ]) assert.match(migration, new RegExp(`create table if not exists public\\.${table}`))
    assert.match(migration, /workspace_native_conversations_direct_unique/)
    assert.match(migration, /direct_user_one::text < direct_user_two::text/)
    assert.match(migration, /native_conversation_can_read/)
    assert.match(migration, /target_user = auth\.uid\(\) or auth\.role\(\) = 'service_role'/)
    assert.match(migration, /team_member\.user_id = target_user/)
    assert.match(migration, /membership\.role in \('owner', 'admin'\)[\s\S]*archived_at is not null/)
    assert.match(migration, /workspace_team_members.*workspace_native_messages.*workspace_native_reactions.*workspace_native_read_cursors/s)
})

test("profile lookup preserves workspace authorization and username privacy", async () => {
    const [profileRoute, profileModal, shell, assignee] = await Promise.all([
        readFile("app/api/workspaces/[workspaceSlug]/members/[userId]/profile/route.ts", "utf8"),
        readFile("components/workspace/WorkspaceMemberProfileModal.tsx", "utf8"),
        readFile("components/workspace/WorkspaceTopBarClient.tsx", "utf8"),
        readFile("components/ui/Assignee.tsx", "utf8"),
    ])
    assert.match(profileRoute, /requireWorkspace\(workspaceSlug\)/)
    assert.match(profileRoute, /eq\("workspace_id", workspace\.id\)\.eq\("user_id", userId\)/)
    assert.match(profileRoute, /username: isSelf \? profile\.username : null/)
    assert.match(profileRoute, /display_name\?\.trim\(\) \|\| profile\.username/)
    assert.match(profileRoute, /in\("workspace_id", currentWorkspaceIds\)/)
    assert.match(profileModal, /Last seen/)
    assert.match(profileModal, /Shared workspaces/)
    assert.match(shell, /state: "heartbeat"/)
    assert.match(assignee, /openWorkspaceMemberProfile\(userId\)/)
})

test("team editing enforces required teams and complete responsibility maps", async () => {
    const [route, relationshipActions, workflow, editor] = await Promise.all([
        readFile("app/api/workspaces/[workspaceSlug]/teams/route.ts", "utf8"),
        readFile("app/[workspaceSlug]/relationships/actions.ts", "utf8"),
        readFile("lib/relationship-workflow.ts", "utf8"),
        readFile("components/communications/TeamCommunicationsWorkspace.tsx", "utf8"),
    ])
    assert.match(route, /Admins membership follows Settings > Users/)
    assert.match(route, /Only the workspace owner can edit Maintenance/)
    assert.match(route, /Assign every active service before saving the fulfilment team/)
    assert.match(route, /Reassign this member's service responsibilities before removing them/)
    assert.match(route, /Reassign this member's maintenance categories before removing them/)
    assert.match(relationshipActions, /fulfilment_team_id/)
    assert.match(relationshipActions, /is not assigned within the selected fulfilment team/)
    assert.match(workflow, /workspace_team_service_responsibilities/)
    assert.match(workflow, /assigneeByService\.get\(service\.service_id\) \?\? null/)
    assert.match(editor, /Map every active service to exactly one selected member/)
    assert.match(editor, /Archived conversation/)
})

test("native messaging supports realtime messages, replies, reactions, reads, and files", async () => {
    const [workspace, messages, reactions, reads, attachments, media] = await Promise.all([
        readFile("components/communications/TeamCommunicationsWorkspace.tsx", "utf8"),
        readFile("app/api/workspaces/[workspaceSlug]/communications/native/messages/route.ts", "utf8"),
        readFile("app/api/workspaces/[workspaceSlug]/communications/native/reactions/route.ts", "utf8"),
        readFile("app/api/workspaces/[workspaceSlug]/communications/native/read/route.ts", "utf8"),
        readFile("app/api/workspaces/[workspaceSlug]/communications/native/attachments/route.ts", "utf8"),
        readFile("app/api/client-messages/media/[...path]/route.ts", "utf8"),
    ])
    for (const table of ["workspace_native_messages", "workspace_native_reactions", "workspace_native_read_cursors", "workspace_team_members"]) assert.match(workspace, new RegExp(`table: "${table}"`))
    assert.match(workspace, /replyingTo/)
    assert.match(workspace, /Type or paste any emoji/)
    assert.match(workspace, /clientRequestId/)
    assert.match(messages, /assertNativeConversationAccess\(conversationId, user\.id, "write"\)/)
    assert.match(messages, /reply_to_message_id/)
    assert.match(reactions, /onConflict: "message_id,reactor_user_id"/)
    assert.match(reads, /current\.last_read_at >= message\.created_at/)
    assert.match(attachments, /createSignedNativeMessageUpload/)
    assert.match(media, /assertNativeConversationAccess\(conversationId, user\.id, "read"\)/)
})
