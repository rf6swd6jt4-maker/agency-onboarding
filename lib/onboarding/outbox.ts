import { getOnboardingUrl } from "@/lib/onboarding/client-creation"
import { getClientPortalUrl } from "@/lib/client-portal/domain"
import { resolveCommunicationDestinations, sendCommunicationDeliveries } from "@/lib/client-messages/omnichannel"
import { platformFailureFingerprint, reportPlatformFailure } from "@/lib/admin/maintenance"
import { deleteOnboardingUploads } from "@/lib/onboarding/uploads"
import { supabaseAdmin } from "@/lib/supabase/admin"
import {
    assertSafeOnboardingStorageCleanupPath,
    sanitizeOnboardingOutboxError,
} from "@/lib/onboarding/outbox-safety"

export { sanitizeOnboardingOutboxError } from "@/lib/onboarding/outbox-safety"

type DeliveryKind = "module_update" | "onboarding_link" | "client_portal_link"

type DeliveryOutboxRow = {
    id: string
    workspace_id: string
    relationship_id: string | null
    session_id: string | null
    portal_session_id: string | null
    correlation_id: string
    kind: DeliveryKind
    destination: string
    payload: Record<string, unknown> | null
    attempt_count: number
}

type StorageCleanupOutboxRow = {
    id: string
    workspace_id: string
    session_id: string | null
    correlation_id: string
    storage_path: string
    reason: string
    attempt_count: number
}

export type OnboardingOutboxProcessResult = {
    deliveryClaimed: number
    deliverySent: number
    deliveryFailed: number
    cleanupClaimed: number
    cleanupCompleted: number
    cleanupFailed: number
    processorErrors: number
}

const EMPTY_RESULT: OnboardingOutboxProcessResult = {
    deliveryClaimed: 0,
    deliverySent: 0,
    deliveryFailed: 0,
    cleanupClaimed: 0,
    cleanupCompleted: 0,
    cleanupFailed: 0,
    processorErrors: 0,
}

function payloadRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function payloadText(payload: Record<string, unknown>, key: string, maximum: number) {
    const value = payload[key]
    return typeof value === "string" ? value.trim().slice(0, maximum) : ""
}

function payloadId(payload: Record<string, unknown>, key: string) {
    const value = payload[key]
    return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value) ? value : null
}

function outboxErrorCode(error: unknown, fallback: string) {
    const value = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : ""
    return /^[A-Za-z0-9_-]{1,80}$/.test(value) ? value.toUpperCase() : fallback
}

async function reportOutboxFailure(input: {
    workspaceId: string
    relationshipId?: string | null
    sessionId?: string | null
    correlationId?: string | null
    outboxId: string
    attemptCount: number
    category: "communications" | "onboarding"
    operation: string
    summary: string
    error: unknown
    fallbackCode: string
    kind?: string
}) {
    const errorSummary = sanitizeOnboardingOutboxError(input.error)
    const errorCode = outboxErrorCode(input.error, input.fallbackCode)
    try {
        const { data: workspace } = await supabaseAdmin.from("workspaces").select("slug").eq("id", input.workspaceId).maybeSingle()
        await reportPlatformFailure({
            workspaceId: input.workspaceId,
            category: input.category,
            source: "onboarding_outbox",
            operation: input.operation,
            fingerprint: platformFailureFingerprint(["onboarding_outbox", input.operation, errorCode, errorSummary]),
            severity: "warning",
            summary: input.summary,
            diagnostics: {
                outbox_id: input.outboxId,
                relationship_id: input.relationshipId ?? null,
                session_id: input.sessionId ?? null,
                kind: input.kind ?? null,
                attempt_count: input.attemptCount,
                error_code: errorCode,
                error_summary: errorSummary,
            },
            sourceHref: workspace?.slug && input.relationshipId
                ? `/${workspace.slug}/onboarding/${input.relationshipId}`
                : workspace?.slug ? `/${workspace.slug}/admin/activity` : null,
            correlationId: input.correlationId ?? null,
            idempotencyKey: `onboarding.outbox.failure:${input.outboxId}:${input.attemptCount}:${input.operation}`,
        })
    } catch {
        console.error("Could not report sanitized onboarding outbox failure", {
            workspaceId: input.workspaceId,
            outboxId: input.outboxId,
            operation: input.operation,
            errorCode,
            errorSummary,
        })
    }
    return { errorCode, errorSummary }
}

async function finishDelivery(
    row: DeliveryOutboxRow,
    succeeded: boolean,
    providerId: string | null,
    errorCode: string | null,
    errorSummary: string | null
) {
    return supabaseAdmin.rpc("finish_onboarding_delivery_outbox", {
        p_workspace_id: row.workspace_id,
        p_outbox_id: row.id,
        p_succeeded: succeeded,
        p_provider_message_id: providerId,
        p_error_code: errorCode,
        p_error_summary: errorSummary,
    })
}

async function deliveryContext(row: DeliveryOutboxRow) {
    const { data: workspace, error: workspaceError } = await supabaseAdmin
        .from("workspaces")
        .select("slug, custom_onboarding_domain, custom_onboarding_domain_status, custom_client_portal_domain, custom_client_portal_domain_status")
        .eq("id", row.workspace_id)
        .maybeSingle()
    if (workspaceError || !workspace) throw new Error(workspaceError?.message ?? "Onboarding delivery workspace was not found")
    if (row.kind === "client_portal_link") {
        if (!row.portal_session_id) throw new Error("Client portal delivery has no portal session")
        const { data: portalSession, error: portalError } = await supabaseAdmin
            .from("client_portal_sessions")
            .select("session_token, relationship_id, status, token_revoked_at")
            .eq("workspace_id", row.workspace_id)
            .eq("id", row.portal_session_id)
            .maybeSingle()
        if (portalError || !portalSession) throw new Error(portalError?.message ?? "Client portal delivery session was not found")
        const relationshipId = portalSession.relationship_id ?? row.relationship_id
        if (!relationshipId || portalSession.relationship_id !== relationshipId || portalSession.status !== "active" || portalSession.token_revoked_at) throw new Error("Client portal delivery session link is not available")
        return {
            relationshipId,
            publicUrl: getClientPortalUrl({
                sessionToken: portalSession.session_token,
                customDomain: workspace.custom_client_portal_domain,
                customDomainVerified: workspace.custom_client_portal_domain_status === "verified",
            }),
        }
    }
    if (!row.session_id) throw new Error("Onboarding delivery has no session")
    const { data: session, error: sessionError } = await supabaseAdmin
        .from("relationship_onboarding_sessions")
        .select("session_token, relationship_id, status, token_revoked_at")
        .eq("workspace_id", row.workspace_id)
        .eq("id", row.session_id)
        .maybeSingle()
    if (sessionError || !session) throw new Error(sessionError?.message ?? "Onboarding delivery session was not found")
    if (!["active", "completed"].includes(session.status) || session.token_revoked_at) throw new Error("Onboarding delivery session link is not available")
    const relationshipId = session.relationship_id ?? row.relationship_id
    if (!relationshipId) throw new Error("Onboarding delivery has no relationship")
    const onboardingUrl = getOnboardingUrl(
        workspace.slug,
        session.session_token,
        workspace.custom_onboarding_domain,
        workspace.custom_onboarding_domain_status === "verified"
    )
    return { relationshipId, publicUrl: onboardingUrl }
}

function deliveryBody(row: DeliveryOutboxRow, publicUrl: string) {
    const payload = payloadRecord(row.payload)
    if (row.kind === "client_portal_link") {
        const introduction = payloadText(payload, "message", 2_000) || "Your client portal is ready."
        return [introduction, `Open your portal: ${publicUrl}`].join("\n\n").slice(0, 4_000)
    }
    if (row.kind === "module_update") {
        const explanation = payloadText(payload, "explanation", 2_000)
            || "We updated this part of your onboarding so we can collect the right information. Please complete it again."
        return [`We've updated part of your onboarding.`, explanation, `Open your onboarding: ${publicUrl}`].join("\n\n").slice(0, 4_000)
    }
    const introduction = payloadText(payload, "message", 2_000)
        || payloadText(payload, "body", 2_000)
        || "Your onboarding link is ready."
    return [introduction, publicUrl].join("\n\n").slice(0, 4_000)
}

function deliveryAutomationLabel(kind: DeliveryKind) {
    if (kind === "module_update") return "Onboarding update"
    if (kind === "client_portal_link") return "Client portal link"
    return "Onboarding link"
}

async function existingDeliveryMessage(row: DeliveryOutboxRow, sentOnly: boolean) {
    let query = supabaseAdmin
        .from("client_messages")
        .select("id, status, provider_message_id, whatsapp_message_id")
        .eq("workspace_id", row.workspace_id)
        .contains("raw_payload", { outbox_id: row.id })
        .order("created_at", { ascending: false })
        .limit(1)
    if (sentOnly) query = query.in("status", ["sent", "send_uncertain", "whatsapp_sent", "whatsapp_delivered", "whatsapp_read"])
    return query.maybeSingle()
}

async function processDeliveryRow(row: DeliveryOutboxRow) {
    let messageLogId: string | null = null
    let providerSent = false
    let sentProviderId: string | null = null
    try {
        const sentMessage = await existingDeliveryMessage(row, true)
        if (sentMessage.error) throw sentMessage.error
        if (sentMessage.data) {
            providerSent = true
            sentProviderId = sentMessage.data.provider_message_id ?? sentMessage.data.whatsapp_message_id ?? null
            const finished = await finishDelivery(row, true, sentProviderId, null, null)
            if (finished.error) throw finished.error
            return true
        }

        const context = await deliveryContext(row)
        const body = deliveryBody(row, context.publicUrl)
        const channels = await resolveCommunicationDestinations({ workspaceId: row.workspace_id, relationshipId: context.relationshipId })
        if (!channels.destinations.length) throw new Error("The relationship has no connected messaging destination")
        const primaryDestination = channels.destinations.find((destination) => destination.primary) ?? channels.destinations[0]
        const payload = payloadRecord(row.payload)
        const clientId = payloadId(payload, "client_id")
        const saleId = payloadId(payload, "sale_id")
        const messageMetadata = {
            outbox_id: row.id,
            kind: row.kind,
            session_id: row.session_id,
            portal_session_id: row.portal_session_id,
            client_sale_id: saleId,
        }
        const existingMessage = await existingDeliveryMessage(row, false)
        if (existingMessage.error) throw existingMessage.error
        if (existingMessage.data) {
            messageLogId = existingMessage.data.id
            const { error } = await supabaseAdmin.from("client_messages").update({
                relationship_id: context.relationshipId,
                client_id: clientId,
                communication_channel_id: primaryDestination.channelId,
                provider: channels.destinations.length > 1 ? "omnichannel" : primaryDestination.provider,
                to_address: primaryDestination.address,
                body,
                status: "sending",
                error: null,
                sender_kind: "automation",
                automation_kind: row.kind,
                automation_label: deliveryAutomationLabel(row.kind),
                raw_payload: messageMetadata,
            }).eq("workspace_id", row.workspace_id).eq("id", messageLogId)
            if (error) throw error
        } else {
            const { data: messageLog, error } = await supabaseAdmin.from("client_messages").insert({
                workspace_id: row.workspace_id,
                relationship_id: context.relationshipId,
                client_id: clientId,
                direction: "outbound",
                communication_channel_id: primaryDestination.channelId,
                provider: channels.destinations.length > 1 ? "omnichannel" : primaryDestination.provider,
                to_address: primaryDestination.address,
                body,
                status: "sending",
                sender_kind: "automation",
                automation_kind: row.kind,
                automation_label: deliveryAutomationLabel(row.kind),
                raw_payload: messageMetadata,
            }).select("id").single()
            if (error || !messageLog) throw error ?? new Error("Could not create onboarding delivery message log")
            messageLogId = messageLog.id
        }
        if (!messageLogId) throw new Error("Could not resolve onboarding delivery message log")

        const delivery = await sendCommunicationDeliveries({
            workspaceId: row.workspace_id,
            relationshipId: context.relationshipId,
            messageId: messageLogId,
            body,
            destinations: channels.destinations,
        })
        const successful = delivery.results.filter((result) => result.ok)
        providerSent = successful.length > 0
        sentProviderId = (successful.find((result) => result.primary) ?? successful[0])?.providerMessageId ?? null
        if (!providerSent) throw new Error(delivery.error ?? "Every onboarding message delivery failed")
        const messageUpdate = await supabaseAdmin.from("client_messages").select("id").eq("workspace_id", row.workspace_id).eq("id", messageLogId).maybeSingle()
        const finished = await finishDelivery(row, true, sentProviderId, null, null)
        if (messageUpdate.error) {
            await reportOutboxFailure({
                workspaceId: row.workspace_id,
                relationshipId: context.relationshipId,
                sessionId: row.session_id,
                correlationId: row.correlation_id,
                outboxId: row.id,
                attemptCount: row.attempt_count,
                category: "communications",
                operation: "record_delivery_message",
                summary: "Delivered onboarding message could not be finalized in the message log",
                error: messageUpdate.error,
                fallbackCode: "ONBOARDING_DELIVERY_LOG_FAILED",
                kind: row.kind,
            })
        }
        if (finished.error) throw finished.error
        return true
    } catch (error) {
        const reported = await reportOutboxFailure({
            workspaceId: row.workspace_id,
            relationshipId: row.relationship_id,
            sessionId: row.session_id,
            correlationId: row.correlation_id,
            outboxId: row.id,
            attemptCount: row.attempt_count,
            category: "communications",
            operation: providerSent ? "finish_delivery" : "send_delivery",
            summary: providerSent ? "Delivered onboarding message could not be finalized" : "Onboarding message delivery failed",
            error,
            fallbackCode: providerSent ? "ONBOARDING_DELIVERY_FINISH_FAILED" : "ONBOARDING_DELIVERY_FAILED",
            kind: row.kind,
        })
        if (!providerSent) {
            if (messageLogId) {
                await supabaseAdmin.from("client_messages").update({ status: "send_failed", error: reported.errorSummary }).eq("workspace_id", row.workspace_id).eq("id", messageLogId)
            }
            const finished = await finishDelivery(row, false, null, reported.errorCode, reported.errorSummary)
            if (finished.error) {
                await reportOutboxFailure({
                    workspaceId: row.workspace_id,
                    relationshipId: row.relationship_id,
                    sessionId: row.session_id,
                    correlationId: row.correlation_id,
                    outboxId: row.id,
                    attemptCount: row.attempt_count,
                    category: "communications",
                    operation: "finish_delivery_failure",
                    summary: "Onboarding delivery failure could not be persisted",
                    error: finished.error,
                    fallbackCode: "ONBOARDING_DELIVERY_FAILURE_PERSIST_FAILED",
                    kind: row.kind,
                })
            }
        }
        return false
    }
}

async function finishStorageCleanup(row: StorageCleanupOutboxRow, succeeded: boolean, errorCode: string | null, errorSummary: string | null) {
    return supabaseAdmin.rpc("finish_onboarding_storage_cleanup_outbox", {
        p_workspace_id: row.workspace_id,
        p_outbox_id: row.id,
        p_succeeded: succeeded,
        p_error_code: errorCode,
        p_error_summary: errorSummary,
    })
}

async function storageCleanupContext(row: StorageCleanupOutboxRow) {
    if (!row.session_id) throw new Error("Onboarding storage cleanup has no session")
    const { data: session, error: sessionError } = await supabaseAdmin
        .from("relationship_onboarding_sessions")
        .select("relationship_id")
        .eq("workspace_id", row.workspace_id)
        .eq("id", row.session_id)
        .maybeSingle()
    if (sessionError || !session) {
        throw new Error(sessionError?.message ?? "Onboarding storage cleanup session was not found")
    }

    const { data: relationship, error: relationshipError } = await supabaseAdmin
        .from("relationships")
        .select("client_id")
        .eq("workspace_id", row.workspace_id)
        .eq("id", session.relationship_id)
        .maybeSingle()
    if (relationshipError || !relationship) {
        throw new Error(relationshipError?.message ?? "Onboarding storage cleanup relationship was not found")
    }

    return {
        workspaceId: row.workspace_id,
        sessionId: row.session_id,
        relationshipId: session.relationship_id,
        legacyClientId: relationship.client_id,
    }
}

async function processStorageCleanupRow(row: StorageCleanupOutboxRow) {
    try {
        const storagePath = row.storage_path
        if (!storagePath) throw new Error("Onboarding storage cleanup path is empty")
        assertSafeOnboardingStorageCleanupPath(
            storagePath,
            await storageCleanupContext(row)
        )
        await deleteOnboardingUploads([storagePath])
        const finished = await finishStorageCleanup(row, true, null, null)
        if (finished.error) throw finished.error
        return true
    } catch (error) {
        const reported = await reportOutboxFailure({
            workspaceId: row.workspace_id,
            sessionId: row.session_id,
            correlationId: row.correlation_id,
            outboxId: row.id,
            attemptCount: row.attempt_count,
            category: "onboarding",
            operation: "storage_cleanup",
            summary: "Superseded onboarding upload cleanup failed",
            error,
            fallbackCode: "ONBOARDING_STORAGE_CLEANUP_FAILED",
            kind: row.reason,
        })
        const finished = await finishStorageCleanup(row, false, reported.errorCode, reported.errorSummary)
        if (finished.error) {
            await reportOutboxFailure({
                workspaceId: row.workspace_id,
                sessionId: row.session_id,
                correlationId: row.correlation_id,
                outboxId: row.id,
                attemptCount: row.attempt_count,
                category: "onboarding",
                operation: "finish_storage_cleanup_failure",
                summary: "Onboarding storage cleanup failure could not be persisted",
                error: finished.error,
                fallbackCode: "ONBOARDING_STORAGE_CLEANUP_PERSIST_FAILED",
                kind: row.reason,
            })
        }
        return false
    }
}

async function reportClaimFailure(workspaceId: string, operation: string, error: unknown) {
    const errorSummary = sanitizeOnboardingOutboxError(error)
    try {
        await reportPlatformFailure({
            workspaceId,
            category: "onboarding",
            source: "onboarding_outbox",
            operation,
            fingerprint: platformFailureFingerprint(["onboarding_outbox", operation, errorSummary]),
            severity: "warning",
            summary: "Onboarding outbox queue could not be claimed",
            diagnostics: { error_summary: errorSummary },
            idempotencyKey: `onboarding.outbox.claim:${workspaceId}:${operation}:${new Date().toISOString().slice(0, 16)}`,
        })
    } catch {
        console.error("Could not report sanitized onboarding outbox claim failure", { workspaceId, operation, errorSummary })
    }
}

export async function processWorkspaceOnboardingOutbox(workspaceId: string, limit = 25): Promise<OnboardingOutboxProcessResult> {
    const result = { ...EMPTY_RESULT }
    const safeLimit = Math.max(1, Math.min(Math.floor(limit) || 25, 100))
    const [deliveryClaim, cleanupClaim] = await Promise.all([
        supabaseAdmin.rpc("claim_onboarding_delivery_outbox", { p_workspace_id: workspaceId, p_limit: safeLimit }),
        supabaseAdmin.rpc("claim_onboarding_storage_cleanup_outbox", { p_workspace_id: workspaceId, p_limit: safeLimit }),
    ])
    const deliveryRows = deliveryClaim.error ? [] : (deliveryClaim.data ?? []) as DeliveryOutboxRow[]
    const cleanupRows = cleanupClaim.error ? [] : (cleanupClaim.data ?? []) as StorageCleanupOutboxRow[]
    if (deliveryClaim.error) {
        result.processorErrors += 1
        await reportClaimFailure(workspaceId, "claim_delivery", deliveryClaim.error)
    }
    if (cleanupClaim.error) {
        result.processorErrors += 1
        await reportClaimFailure(workspaceId, "claim_storage_cleanup", cleanupClaim.error)
    }
    result.deliveryClaimed = deliveryRows.length
    result.cleanupClaimed = cleanupRows.length

    for (const row of deliveryRows) {
        try {
            if (await processDeliveryRow(row)) result.deliverySent += 1
            else result.deliveryFailed += 1
        } catch (error) {
            result.deliveryFailed += 1
            await reportOutboxFailure({ workspaceId, relationshipId: row.relationship_id, sessionId: row.session_id, correlationId: row.correlation_id, outboxId: row.id, attemptCount: row.attempt_count, category: "communications", operation: "unexpected_delivery", summary: "Unexpected onboarding delivery worker failure", error, fallbackCode: "ONBOARDING_DELIVERY_UNEXPECTED", kind: row.kind })
        }
    }
    for (const row of cleanupRows) {
        try {
            if (await processStorageCleanupRow(row)) result.cleanupCompleted += 1
            else result.cleanupFailed += 1
        } catch (error) {
            result.cleanupFailed += 1
            await reportOutboxFailure({ workspaceId, sessionId: row.session_id, correlationId: row.correlation_id, outboxId: row.id, attemptCount: row.attempt_count, category: "onboarding", operation: "unexpected_storage_cleanup", summary: "Unexpected onboarding storage cleanup worker failure", error, fallbackCode: "ONBOARDING_STORAGE_CLEANUP_UNEXPECTED", kind: row.reason })
        }
    }
    return result
}

async function pendingWorkspaceIds(table: "onboarding_delivery_outbox" | "onboarding_storage_cleanup_outbox", statuses: string[]) {
    const ids = new Set<string>()
    const pageSize = 1_000
    for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await supabaseAdmin.from(table)
            .select("workspace_id")
            .in("status", statuses)
            .order("workspace_id")
            .range(offset, offset + pageSize - 1)
        if (error) throw error
        for (const row of data ?? []) if (row.workspace_id) ids.add(String(row.workspace_id))
        if ((data?.length ?? 0) < pageSize) break
    }
    return ids
}

export async function processAllOnboardingOutboxes(limitPerWorkspace = 25) {
    const [deliveryWorkspaces, cleanupWorkspaces] = await Promise.all([
        pendingWorkspaceIds("onboarding_delivery_outbox", ["queued", "failed", "processing"]),
        pendingWorkspaceIds("onboarding_storage_cleanup_outbox", ["queued", "failed", "processing"]),
    ])
    const workspaceIds = [...new Set([...deliveryWorkspaces, ...cleanupWorkspaces])]
    const aggregate = { ...EMPTY_RESULT }
    for (const workspaceId of workspaceIds) {
        const result = await processWorkspaceOnboardingOutbox(workspaceId, limitPerWorkspace)
        for (const key of Object.keys(aggregate) as Array<keyof OnboardingOutboxProcessResult>) aggregate[key] += result[key]
    }
    return { workspaceCount: workspaceIds.length, ...aggregate }
}
