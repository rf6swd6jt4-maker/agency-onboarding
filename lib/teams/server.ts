import { communicationAttachmentFromValue } from "@/lib/communications/attachments"
import { loadCommunicationPeople, loadCommunicationStickers } from "@/lib/communications/server"
import { maintenanceCategoryLabel, MAINTENANCE_CATEGORIES } from "@/lib/admin/maintenance"
import { profileAvatarUrl } from "@/lib/profile-avatar"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { createSupabaseServerClient } from "@/lib/supabase/server"
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
        senderWorkspaceRole: row.sender_workspace_role === "owner" || row.sender_workspace_role === "admin" || row.sender_workspace_role === "staff" ? row.sender_workspace_role : null,
        body: typeof row.body === "string" ? row.body : "",
        replyToMessageId: text(row.reply_to_message_id),
        attachment: communicationAttachmentFromValue(row.attachment),
        createdAt,
        editedAt: text(row.edited_at),
    }
}

async function loadNativeEditTimes(workspaceId: string, conversationId?: string) {
    let query = supabaseAdmin
        .from("workspace_native_messages")
        .select("id, edited_at")
        .eq("workspace_id", workspaceId)
        .not("edited_at", "is", null)
    if (conversationId) query = query.eq("conversation_id", conversationId)
    const { data, error } = await query
    if (error) throw new Error(error.message)
    return new Map((data ?? []).map((row) => [row.id, row.edited_at as string]))
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
    const currentUserRole: NativeCommunicationsBootstrap["currentUserRole"] = input.role === "owner" || input.role === "admin" ? input.role : "staff"
    const base = {
        workspaceId: input.workspaceId,
        workspaceSlug: input.workspaceSlug,
        currentUser: peopleResult.currentUser,
        people: peopleResult.people,
        formerPeople: [] as CommunicationPerson[],
        stickers: stickerResult.stickers,
        teams,
        services,
        maintenanceCategories: MAINTENANCE_CATEGORIES.map((key) => ({ key, label: maintenanceCategoryLabel(key) })),
        canManageTeams: input.role === "owner" || input.role === "admin",
        isOwner: input.role === "owner",
        currentUserRole,
        requestedConversationId: input.requestedConversationId && UUID_PATTERN.test(input.requestedConversationId) ? input.requestedConversationId : null,
        requestedDmUserId: input.requestedDmUserId && UUID_PATTERN.test(input.requestedDmUserId) ? input.requestedDmUserId : null,
    }
    if (!schemaReady) return { ...base, conversations: [], reactions: [], readCursors: [], schemaReady: false }

    const supabase = await createSupabaseServerClient()
    const [conversationResult, participantResult, messageResult, reactionResult, cursorResult, membershipResult] = await Promise.all([
        supabaseAdmin.from("workspace_native_conversations").select("id, kind, team_id, direct_user_one, direct_user_two, archived_at, pinned_message_id, updated_at").eq("workspace_id", input.workspaceId).order("updated_at", { ascending: false }),
        supabaseAdmin.from("workspace_native_conversation_participants").select("conversation_id, user_id").eq("workspace_id", input.workspaceId),
        supabase.rpc("communication_native_messages", { p_workspace_id: input.workspaceId, p_conversation_id: null, p_limit: 4000 }),
        supabaseAdmin.from("workspace_native_reactions").select("id, conversation_id, message_id, reactor_user_id, emoji, updated_at").eq("workspace_id", input.workspaceId),
        supabaseAdmin.from("workspace_native_read_cursors").select("conversation_id, user_id, last_read_message_id, last_read_at").eq("workspace_id", input.workspaceId),
        supabaseAdmin.from("workspace_memberships").select("user_id, role").eq("workspace_id", input.workspaceId),
    ])
    const fatal = [conversationResult.error, participantResult.error, messageResult.error, reactionResult.error, cursorResult.error, membershipResult.error].find(Boolean)
    if (fatal) throw new Error(fatal!.message)
    const activePeopleById = new Map(peopleResult.people.map((person) => [person.id, person]))
    const historicalIds = [...new Set([
        ...(messageResult.data ?? []).map((message: { sender_user_id?: string | null }) => message.sender_user_id),
        ...(reactionResult.data ?? []).map((reaction) => reaction.reactor_user_id),
        ...(conversationResult.data ?? []).flatMap((conversation) => [conversation.direct_user_one, conversation.direct_user_two]),
    ].filter((id): id is string => Boolean(id) && !activePeopleById.has(id)))]
    const attributionResult = historicalIds.length
        ? await supabaseAdmin.from("account_user_attributions").select("user_id, username, display_name, avatar_path, removed_at").in("user_id", historicalIds)
        : { data: [], error: null }
    if (attributionResult.error && attributionResult.error.code !== "42P01") throw new Error(attributionResult.error.message)
    const formerPeople: CommunicationPerson[] = (attributionResult.data ?? []).map((profile) => ({
        id: profile.user_id,
        name: profile.display_name?.trim() || profile.username || "Former member",
        avatarSrc: profile.avatar_path ? profileAvatarUrl(profile.username, profile.avatar_path) : null,
        former: Boolean(profile.removed_at),
    }))
    const peopleById = new Map([...peopleResult.people, ...formerPeople].map((person) => [person.id, person]))
    const teamById = new Map(teams.map((team) => [team.id, team]))
    const participants = new Map<string, string[]>()
    for (const participant of participantResult.data ?? []) participants.set(participant.conversation_id, [...(participants.get(participant.conversation_id) ?? []), participant.user_id])
    const editedAtByMessageId = await loadNativeEditTimes(input.workspaceId)
    const messages = new Map<string, NativeMessage[]>()
    for (const row of [...(messageResult.data ?? [])].reverse()) {
        const source = record(row)
        const message = nativeMessageFromRow({ ...source, edited_at: editedAtByMessageId.get(text(source.id) ?? "") ?? null })
        if (message) messages.set(message.conversationId, [...(messages.get(message.conversationId) ?? []), message])
    }
    const conversations = (conversationResult.data ?? []).flatMap<NativeConversation>((conversation) => {
        if (conversation.kind === "direct") {
            const memberIds = participants.get(conversation.id) ?? []
            if (!memberIds.includes(input.currentUserId)) return []
            const otherId = [conversation.direct_user_one, conversation.direct_user_two].find((id) => id && id !== input.currentUserId)
                ?? memberIds.find((id) => id !== input.currentUserId)
                ?? input.currentUserId
            const person: CommunicationPerson = peopleById.get(otherId) ?? { id: otherId, name: "Workspace member", avatarSrc: null, former: false }
            const archived = Boolean(conversation.archived_at) || Boolean(person.former)
            return [{ id: conversation.id, kind: "direct" as const, teamId: null, title: person.name, subtitle: archived ? "Former member · read-only history" : "Direct message", avatarSrc: person.avatarSrc, memberIds, archived, canWrite: !archived, pinnedMessageId: conversation.pinned_message_id, updatedAt: conversation.updated_at, messages: messages.get(conversation.id) ?? [] }]
        }
        const team = conversation.team_id ? teamById.get(conversation.team_id) : null
        if (!team) return []
        const archived = Boolean(team.archivedAt)
        if (!team.memberIds.includes(input.currentUserId)) return []
        return [{ id: conversation.id, kind: "team" as const, teamId: team.id, title: team.name, subtitle: `${team.memberIds.length} member${team.memberIds.length === 1 ? "" : "s"}`, avatarSrc: null, memberIds: team.memberIds, archived, canWrite: !archived && team.memberIds.includes(input.currentUserId), pinnedMessageId: conversation.pinned_message_id, updatedAt: conversation.updated_at, messages: messages.get(conversation.id) ?? [] }]
    }).sort((left, right) => (right.messages.at(-1)?.createdAt ?? right.updatedAt).localeCompare(left.messages.at(-1)?.createdAt ?? left.updatedAt) || left.title.localeCompare(right.title))
    const conversationIds = new Set(conversations.map((conversation) => conversation.id))
    const reactions: NativeReaction[] = (reactionResult.data ?? []).flatMap((reaction) => conversationIds.has(reaction.conversation_id) ? [{ id: reaction.id, conversationId: reaction.conversation_id, messageId: reaction.message_id, reactorUserId: reaction.reactor_user_id, emoji: reaction.emoji, updatedAt: reaction.updated_at }] : [])
    const readCursors: NativeReadCursor[] = (cursorResult.data ?? []).flatMap((cursor) => conversationIds.has(cursor.conversation_id) ? [{ conversationId: cursor.conversation_id, userId: cursor.user_id, lastReadMessageId: cursor.last_read_message_id, lastReadAt: cursor.last_read_at }] : [])
    return { ...base, formerPeople, conversations, reactions, readCursors, schemaReady: true }
}

export async function loadNativeMessagesForCurrentUser(input: {
    workspaceId: string
    conversationId: string
    limit?: number
}) {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.rpc("communication_native_messages", {
        p_workspace_id: input.workspaceId,
        p_conversation_id: input.conversationId,
        p_limit: input.limit ?? 1000,
    })
    if (error) throw new Error(error.message)
    const editedAtByMessageId = await loadNativeEditTimes(input.workspaceId, input.conversationId)
    return [...(data ?? [])].reverse().flatMap((row: unknown) => {
        const source = record(row)
        return nativeMessageFromRow({ ...source, edited_at: editedAtByMessageId.get(text(source.id) ?? "") ?? null }) ?? []
    })
}

export async function loadNativeMessageForCurrentUser(input: {
    workspaceId: string
    messageId: string
}) {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.rpc("communication_native_message", {
        p_workspace_id: input.workspaceId,
        p_message_id: input.messageId,
    })
    if (error) throw new Error(error.message)
    const source = record((data ?? [])[0])
    const id = text(source.id)
    if (!id) return null
    const editResult = await supabaseAdmin.from("workspace_native_messages").select("edited_at").eq("workspace_id", input.workspaceId).eq("id", id).maybeSingle()
    if (editResult.error) throw new Error(editResult.error.message)
    return nativeMessageFromRow({ ...source, edited_at: editResult.data?.edited_at ?? null })
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
