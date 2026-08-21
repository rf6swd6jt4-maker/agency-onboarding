const PRODUCTION_AUTH_ORIGIN = "https://auth.betelgeze.com"

export function authOrigin(fallbackOrigin?: string) {
    const configured = process.env.NEXT_PUBLIC_AUTH_URL?.trim()
    const candidate = configured
        || (process.env.NODE_ENV === "production" ? PRODUCTION_AUTH_ORIGIN : fallbackOrigin)
        || process.env.NEXT_PUBLIC_SITE_URL
        || "http://localhost:3000"
    return new URL(candidate).origin
}

export function authHostname() {
    return new URL(authOrigin()).hostname.toLowerCase()
}
