import { communicationAttachmentFromValue } from "@/lib/communications/attachments"
import { loadCommunicationPeople, loadCommunicationStickers } from "@/lib/communications/server"
import { maintenanceCategoryLabel, MAINTENANCE_CATEGORIES } from "@/lib/admin/maintenance"
import { profileAvatarUrl } from "@/lib/profile-avatar"
import { supabaseAdmin } from "@/lib/supabase/admin"
import type { CommunicationAttachment, CommunicationPerson } from "@/lib/communications/types"
import type { NativeCommunicationsBootstrap, NativeConversation, NativeMessage, NativeReaction, NativeReadCursor, WorkspaceTeam, WorkspaceTeamKind } from "@/lib/teams/types"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function record(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown) {
    return typeof value === "string" && value ? value : null
}

export function nativeMessageFromRow(value: unknown): NativeMessage | null {
    const row = record(value)
    const id = text(row.id)
    const conversationId = text(row.conversation_id)
    const senderUserId = text(row.sender_user_id)
    const createdAt = text(row.created_at)
    if (!id || !conversationId || !senderUserId || !createdAt) return null
    return {
        id,
        clientRequestId: text(row.client_request_id),
        conversationId,
        senderUserId,
        body: typeof row.body === "string" ? row.body : "",
        replyToMessageId: text(row.reply_to_message_id),
        attachment: communicationAttachmentFromValue(row.attachment),
        createdAt,
    }
}

export async function assertNativeConversationAccess(conversationId: string, userId: string, mode: "read" | "write") {
    if (!UUID_PATTERN.test(conversationId)) return null
    const functionName = mode === "write" ? "native_conversation_can_write" : "native_conversation_can_read"
    const { data, error } = await supabaseAdmin.rpc(functionName, { target_conversation: conversationId, target_user: userId })
    if (error) throw new Error(error.message)
    return data === true ? conversationId : null
}

export async function loadWorkspaceTeams(workspaceId: string): Promise<{ teams: WorkspaceTeam[]; services: Array<{ id: string; name: string }>; schemaReady: boolean }> {
    const [teamResult, memberResult, responsibilityResult, serviceResult, revisionResult, maintenanceResult] = await Promise.all([
        supabaseAdmin.from("workspace_teams").select("id, name, kind, archived_at, created_at").eq("workspace_id", workspaceId).order("created_at"),
        supabaseAdmin.from("workspace_team_members").select("team_id, user_id").eq("workspace_id", workspaceId),
        supabaseAdmin.from("workspace_team_service_responsibilities").select("team_id, service_id, responsible_user_id").eq("workspace_id", workspaceId),
        supabaseAdmin.from("onboarding_services").select("id, state").eq("workspace_id", workspaceId).eq("state", "active"),
        supabaseAdmin.from("onboarding_service_revisions").select("service_id, name, revision_number").eq("workspace_id", workspaceId).order("revision_number", { ascending: false }),
        supabaseAdmin.from("workspace_maintenance_routing").select("category, responsible_user_id").eq("workspace_id", workspaceId),
    ])
    const schemaError = [teamResult.error, memberResult.error, responsibilityResult.error].find((error) => error?.code === "42P01" || error?.code === "42703" || error?.code === "PGRST204")
    if (schemaError) return { teams: [], services: [], schemaReady: false }
    const fatal = [teamResult.error, memberResult.error, responsibilityResult.error, serviceResult.error, revisionResult.error, maintenanceResult.error].find(Boolean)
    if (fatal) throw new Error(fatal!.message)
    const latestName = new Map<string, string>()
    for (const revision of revisionResult.data ?? []) if (!latestName.has(revision.service_id)) latestName.set(revision.service_id, revision.name)
    const services = (serviceResult.data ?? []).map((service) => ({ id: service.id, name: latestName.get(service.id) ?? "Service" })).sort((left, right) => left.name.localeCompare(right.name))
    const serviceNames = new Map(services.map((service) => [service.id, service.name]))
    const memberIds = new Map<string, string[]>()
    for (const member of memberResult.data ?? []) memberIds.set(member.team_id, [...(memberIds.get(member.team_id) ?? []), member.user_id])
    const responsibilities = new Map<string, WorkspaceTeam["responsibilities"]>()
    for (const item of responsibilityResult.data ?? []) responsibilities.set(item.team_id, [...(responsibilities.get(item.team_id) ?? []), { serviceId: item.service_id, serviceName: serviceNames.get(item.service_id) ?? "Service", userId: item.responsible_user_id }])
    const maintenanceTeamId = (teamResult.data ?? []).find((team) => team.kind === "maintenance")?.id ?? null
    return {
        schemaReady: true,
        services,
        teams: (teamResult.data ?? []).flatMap((team) => (["admins", "maintenance", "custom"].includes(team.kind) ? [{
            id: team.id,
            name: team.name,
            kind: team.kind as WorkspaceTeamKind,
            archivedAt: team.archived_at,
            memberIds: memberIds.get(team.id) ?? [],
            responsibilities: responsibilities.get(team.id) ?? [],
            maintenanceResponsibilities: team.id === maintenanceTeamId ? (maintenanceResult.data ?? []).map((route) => ({ category: route.category, userId: route.responsible_user_id })) : [],
        }] : [])),
    }
}

export async function loadNativeCommunications(input: {
    workspaceId: string
    workspaceSlug: string
    currentUserId: string
    role: string
    requestedConversationId?: string | null
    requestedDmUserId?: string | null
}): Promise<NativeCommunicationsBootstrap> {
    const [{ teams, services, schemaReady }, peopleResult, stickerResult] = await Promise.all([
        loadWorkspaceTeams(input.workspaceId),
        loadCommunicationPeople(input.workspaceId, input.currentUserId),
        loadCommunicationStickers(input.workspaceId),
    ])
    const base = {
        workspaceId: input.workspaceId,
        workspaceSlug: input.workspaceSlug,
        currentUser: peopleResult.currentUser,
        people: peopleResult.people,
        stickers: stickerResult.stickers,
        teams,
        services,
        maintenanceCategories: MAINTENANCE_CATEGORIES.map((key) => ({ key, label: maintenanceCategoryLabel(key) })),
        canManageTeams: input.role === "owner" || input.role === "admin",
        isOwner: input.role === "owner",
        requestedConversationId: input.requestedConversationId && UUID_PATTERN.test(input.requestedConversationId) ? input.requestedConversationId : null,
        requestedDmUserId: input.requestedDmUserId && UUID_PATTERN.test(input.requestedDmUserId) ? input.requestedDmUserId : null,
    }
    if (!schemaReady) return { ...base, conversations: [], reactions: [], readCursors: [], schemaReady: false }

    const [conversationResult, participantResult, messageResult, reactionResult, cursorResult, membershipResult] = await Promise.all([
        supabaseAdmin.from("workspace_native_conversations").select("id, kind, team_id, direct_user_one, direct_user_two, updated_at").eq("workspace_id", input.workspaceId).order("updated_at", { ascending: false }),
        supabaseAdmin.from("workspace_native_conversation_participants").select("conversation_id, user_id").eq("workspace_id", input.workspaceId),
        supabaseAdmin.from("workspace_native_messages").select("id, client_request_id, conversation_id, sender_user_id, body, reply_to_message_id, attachment, created_at").eq("workspace_id", input.workspaceId).order("created_at").limit(4000),
        supabaseAdmin.from("workspace_native_reactions").select("id, conversation_id, message_id, reactor_user_id, emoji, updated_at").eq("workspace_id", input.workspaceId),
        supabaseAdmin.from("workspace_native_read_cursors").select("conversation_id, user_id, last_read_message_id, last_read_at").eq("workspace_id", input.workspaceId),
        supabaseAdmin.from("workspace_memberships").select("user_id, role").eq("workspace_id", input.workspaceId),
    ])
    const fatal = [conversationResult.error, participantResult.error, messageResult.error, reactionResult.error, cursorResult.error, membershipResult.error].find(Boolean)
    if (fatal) throw new Error(fatal!.message)
    const peopleById = new Map(peopleResult.people.map((person) => [person.id, person]))
    const teamById = new Map(teams.map((team) => [team.id, team]))
    const participants = new Map<string, string[]>()
    for (const participant of participantResult.data ?? []) participants.set(participant.conversation_id, [...(participants.get(participant.conversation_id) ?? []), participant.user_id])
    const messages = new Map<string, NativeMessage[]>()
    for (const row of messageResult.data ?? []) {
        const message = nativeMessageFromRow(row)
        if (message) messages.set(message.conversationId, [...(messages.get(message.conversationId) ?? []), message])
    }
    const canInspectArchived = input.role === "owner" || input.role === "admin"
    const conversations = (conversationResult.data ?? []).flatMap<NativeConversation>((conversation) => {
        if (conversation.kind === "direct") {
            const memberIds = participants.get(conversation.id) ?? []
            if (!memberIds.includes(input.currentUserId)) return []
            const otherId = memberIds.find((id) => id !== input.currentUserId) ?? input.currentUserId
            const person = peopleById.get(otherId) ?? { id: otherId, name: "Workspace member", avatarSrc: null }
            return [{ id: conversation.id, kind: "direct" as const, teamId: null, title: person.name, subtitle: "Direct message", avatarSrc: person.avatarSrc, memberIds, archived: false, canWrite: true, updatedAt: conversation.updated_at, messages: messages.get(conversation.id) ?? [] }]
        }
        const team = conversation.team_id ? teamById.get(conversation.team_id) : null
        if (!team) return []
        const archived = Boolean(team.archivedAt)
        if (!team.memberIds.includes(input.currentUserId) && !(archived && canInspectArchived)) return []
        return [{ id: conversation.id, kind: "team" as const, teamId: team.id, title: team.name, subtitle: `${team.memberIds.length} member${team.memberIds.length === 1 ? "" : "s"}`, avatarSrc: null, memberIds: team.memberIds, archived, canWrite: !archived && team.memberIds.includes(input.currentUserId), updatedAt: conversation.updated_at, messages: messages.get(conversation.id) ?? [] }]
    }).sort((left, right) => (right.messages.at(-1)?.createdAt ?? right.updatedAt).localeCompare(left.messages.at(-1)?.createdAt ?? left.updatedAt) || left.title.localeCompare(right.title))
    const conversationIds = new Set(conversations.map((conversation) => conversation.id))
    const reactions: NativeReaction[] = (reactionResult.data ?? []).flatMap((reaction) => conversationIds.has(reaction.conversation_id) ? [{ id: reaction.id, conversationId: reaction.conversation_id, messageId: reaction.message_id, reactorUserId: reaction.reactor_user_id, emoji: reaction.emoji, updatedAt: reaction.updated_at }] : [])
    const readCursors: NativeReadCursor[] = (cursorResult.data ?? []).flatMap((cursor) => conversationIds.has(cursor.conversation_id) ? [{ conversationId: cursor.conversation_id, userId: cursor.user_id, lastReadMessageId: cursor.last_read_message_id, lastReadAt: cursor.last_read_at }] : [])
    return { ...base, conversations, reactions, readCursors, schemaReady: true }
}

export function nativeAttachmentFromInput(value: unknown): CommunicationAttachment | null {
    return communicationAttachmentFromValue(value)
}

export async function loadWorkspaceMemberProfiles(workspaceId: string): Promise<Array<CommunicationPerson & { username: string }>> {
    const { data: memberships, error } = await supabaseAdmin.from("workspace_memberships").select("user_id").eq("workspace_id", workspaceId)
    if (error) throw new Error(error.message)
    const ids = (memberships ?? []).map((membership) => membership.user_id)
    const { data: profiles, error: profileError } = ids.length ? await supabaseAdmin.from("user_profiles").select("user_id, username, display_name, avatar_path").in("user_id", ids) : { data: [], error: null }
    if (profileError) throw new Error(profileError.message)
    return (profiles ?? []).map((profile) => ({ id: profile.user_id, username: profile.username, name: profile.display_name?.trim() || profile.username, avatarSrc: profile.avatar_path ? profileAvatarUrl(profile.username, profile.avatar_path) : null }))
}
