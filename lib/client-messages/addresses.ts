const TRUNK_ZERO_COUNTRY_CODES = [
    "27",
    "31",
    "32",
    "33",
    "353",
    "44",
    "49",
    "61",
    "64",
]

export function normalizePhoneNumber(value: string): string {
    let compactAddress = value
        .replace(/\b(?:ext|extension|x)\.?\s*\d+$/iu, "")
        .replace(/[^\d+]/g, "")
        .replace(/(?!^)\+/g, "")

    if (compactAddress.startsWith("00")) {
        compactAddress = `+${compactAddress.slice(2)}`
    }

    if (!compactAddress) return ""

    const digitsOnly = compactAddress.replace(/[^\d]/g, "")

    if (compactAddress.startsWith("+") && /^\d{10}$/.test(digitsOnly)) {
        compactAddress = `+1${digitsOnly}`
    }

    if (!compactAddress.startsWith("+")) {
        if (/^\d{10}$/.test(compactAddress)) {
            compactAddress = `+1${compactAddress}`
        } else if (/^1\d{10}$/.test(compactAddress)) {
            compactAddress = `+${compactAddress}`
        } else {
            compactAddress = `+${compactAddress}`
        }
    }

    for (const countryCode of TRUNK_ZERO_COUNTRY_CODES) {
        const trunkPrefix = `+${countryCode}0`

        if (compactAddress.startsWith(trunkPrefix)) {
            return `+${countryCode}${compactAddress.slice(trunkPrefix.length)}`
        }
    }

    return compactAddress
}

function getChannelAndAddress(value: string) {
    const trimmed = value.trim()
    const [channel, address] = trimmed.includes(":")
        ? trimmed.split(":", 2)
        : ["whatsapp", trimmed]

    return {
        channel: channel.toLowerCase(),
        address,
    }
}

export function normalizeMessageAddress(value: string): string {
    const { channel, address } = getChannelAndAddress(value)
    const normalizedAddress = normalizePhoneNumber(address)

    if (!normalizedAddress) return ""

    return `${channel}:${normalizedAddress}`
}

export function normalizeProviderAddress(provider: "meta_whatsapp" | "twilio_sms", value: string): string {
    const address = value.includes(":") ? value.split(":", 2)[1] : value
    const normalized = normalizePhoneNumber(address)
    if (!normalized) return ""
    return `${provider === "meta_whatsapp" ? "whatsapp" : "sms"}:${normalized}`
}

export function isUsablePhoneNumber(value: string | null | undefined): boolean {
    return normalizePhoneNumber(value ?? "").replace(/\D/g, "").length >= 8
}

export function resolvePrimaryMessagingProvider(input: {
    requestedProvider: "meta_whatsapp" | "twilio_sms"
    smsPhone: string | null | undefined
    whatsappPhone: string | null | undefined
}): "meta_whatsapp" | "twilio_sms" {
    const smsAvailable = isUsablePhoneNumber(input.smsPhone)
    const whatsappAvailable = isUsablePhoneNumber(input.whatsappPhone)

    if (input.requestedProvider === "twilio_sms" && smsAvailable) return "twilio_sms"
    if (input.requestedProvider === "meta_whatsapp" && whatsappAvailable) return "meta_whatsapp"
    if (smsAvailable) return "twilio_sms"
    if (whatsappAvailable) return "meta_whatsapp"
    return input.requestedProvider
}

export function toE164Recipient(value: string): string {
    const source = value.includes(":") ? value.split(":", 2)[1] : value
    return normalizePhoneNumber(source)
}

export function getEquivalentMessageAddresses(value: string): string[] {
    const normalizedAddress = normalizeMessageAddress(value)

    if (!normalizedAddress) return []

    const { channel, address } = getChannelAndAddress(normalizedAddress)
    const addresses = new Set([normalizedAddress])

    if (/^\+1\d{10}$/.test(address)) {
        addresses.add(`${channel}:+${address.slice(2)}`)
    }

    for (const countryCode of TRUNK_ZERO_COUNTRY_CODES) {
        const countryPrefix = `+${countryCode}`

        if (address.startsWith(countryPrefix)) {
            addresses.add(
                `${channel}:${countryPrefix}0${address.slice(countryPrefix.length)}`
            )
        }
    }

    return [...addresses]
}

export function getMessageAddressFormatHint(value: string): string | null {
    const normalizedAddress = normalizeMessageAddress(value)
    const trimmed = value.trim()

    if (!trimmed) return "Add a WhatsApp phone number."
    if (!normalizedAddress) return "Use digits with a country code, like +15551234567."

    const displayedNormalizedAddress = displayMessageAddress(normalizedAddress)
    const displayedInputAddress = displayMessageAddress(trimmed)

    if (displayedInputAddress !== displayedNormalizedAddress) {
        return `Saved as ${displayedNormalizedAddress}.`
    }

    return null
}

export function toMetaWhatsAppRecipient(value: string): string {
    const normalizedAddress = normalizeMessageAddress(value)
    const source = normalizedAddress || value

    if (!source.includes(":")) return source.replace(/[^\d]/g, "")

    const [, address] = source.split(":", 2)

    return address.replace(/[^\d]/g, "")
}

export function displayMessageAddress(value: string): string {
    if (!value.includes(":")) return value

    const [, address] = value.split(":", 2)

    return address
}

export function formatClientInboundMessage({
    clientName,
    body,
    showClientName = true,
}: {
    clientName: string
    body: string
    showClientName?: boolean
}) {
    return showClientName ? [`**${clientName}**`, body].join("\n") : body
}
