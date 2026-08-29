import type { CommunicationMessage } from "@/lib/communications/types"

type ReactionCandidate = Pick<CommunicationMessage, "createdAt" | "deliveries" | "provider" | "providerMessageId">

export function clientMessageSupportsReaction(message: ReactionCandidate, whatsappReactionCutoff: number) {
    if (message.provider === "client_portal") return true
    const usesWhatsApp = message.provider === "meta_whatsapp"
        || Boolean(message.deliveries?.some((delivery) => delivery.provider === "meta_whatsapp"))
    return usesWhatsApp
        && Boolean(message.providerMessageId)
        && new Date(message.createdAt).getTime() >= whatsappReactionCutoff
}
