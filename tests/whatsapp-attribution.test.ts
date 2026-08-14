import assert from "node:assert/strict"
import test from "node:test"

import {
    formatWhatsAppAttributedMessage,
    normalizeChatDisplayName,
} from "../lib/client-messages/whatsapp-attribution.ts"

test("chat display names are non-unique human-readable labels", () => {
    assert.equal(normalizeChatDisplayName("  Patryk   Jedryszczyk  "), "Patryk Jedryszczyk")
    assert.equal(normalizeChatDisplayName("Rick"), "Rick")
    assert.equal(normalizeChatDisplayName("x".repeat(51)), null)
})

test("WhatsApp messages begin with one bold attributed sender line", () => {
    assert.equal(formatWhatsAppAttributedMessage("Patryk", "Hello there"), "*~ Patryk*\nHello there")
    assert.equal(formatWhatsAppAttributedMessage(null, "Automated update"), "*~ Scaylup*\nAutomated update")
    assert.equal(formatWhatsAppAttributedMessage("*Rick*", "Hi"), "*~ Rick*\nHi")
})
