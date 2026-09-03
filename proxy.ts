import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { migrateLegacyAuthCookies } from "@/lib/supabase/legacy-cookies"
import { applySessionResponseHeaders, carrySessionResponse, persistentSessionOptions, sessionCookieDomain, sessionCookieOptions } from "@/lib/supabase/session-cookies"
import { authHostname, authOrigin } from "@/lib/auth/origin"
import { WORKSPACE_TAB_FRAME_PARAM } from "@/lib/workspace-tabs"
import { WORKSPACE_SHELL_INTERNAL_PREFIX, WORKSPACE_SHELL_REQUEST_HEADER, workspaceRouteUsesShell, workspaceShellRoute } from "@/lib/workspace-shell"

async function refreshSession(request: NextRequest) {
    const headers = requestHeadersWithCurrentPath(request)
    let response = NextResponse.next({ request: { headers } })
    migrateLegacyAuthCookies(request, response)
    response = carrySessionResponse(response, NextResponse.next({
        request: { headers: requestHeadersWithCurrentPath(request) },
    }))
    const sessionDomain = sessionCookieDomain()
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        cookieOptions: sessionCookieOptions(sessionDomain),
        cookies: {
            getAll: () => request.cookies.getAll(),
            setAll: (items, responseHeaders) => {
                // The page rendered behind Proxy must see the refreshed session
                // immediately. Updating only the browser response leaves Server
                // Components with the expired token for this request and causes a
                // spurious redirect back through login.
                items.forEach(({ name, value }) => request.cookies.set(name, value))
                response = carrySessionResponse(response, NextResponse.next({
                    request: { headers: requestHeadersWithCurrentPath(request) },
                }))
                items.forEach(({ name, value, options }) =>
                    response.cookies.set(name, value, persistentSessionOptions(options, sessionDomain))
                )
                applySessionResponseHeaders(response, responseHeaders)
            },
        },
    })
    // getClaims verifies locally when the project uses asymmetric signing
    // keys, while still refreshing an expired session when needed.
    const { data } = await supabase.auth.getClaims()
    return {
        response,
        aal: typeof data?.claims?.aal === "string" ? data.claims.aal : null,
        userId: typeof data?.claims?.sub === "string" ? data.claims.sub : null,
    }
}

function requestHostname(request: NextRequest) {
    return request.headers.get("host")?.split(":")[0]?.toLowerCase() ?? null
}

const DASHBOARD_HOST = "dashboard.betelgeze.com"
const APP_HOST = "app.betelgeze.com"
const ONBOARDING_HOST = "onboarding.betelgeze.com"
const AUTH_HOST = authHostname()
const AUTH_PATHS = [
    "/login", "/mfa", "/forgot-password", "/update-password",
    "/email-confirmed", "/check-email", "/sign-up", "/invitation",
    "/auth", "/logout", "/privacy",
]
const AUTH_API_PATHS = [
    "/api/account/onboarding", "/api/account/username", "/api/account/welcome",
    "/api/auth/login", "/api/auth/mfa", "/api/auth/recovery", "/api/auth/session-recovery",
    "/api/auth/send-email-hook", "/api/email/resend-webhook",
]

function isAuthHostPath(path: string) {
    return [...AUTH_PATHS, ...AUTH_API_PATHS].some((authPath) => path === authPath || path.startsWith(`${authPath}/`))
}

function withRewrite(request: NextRequest, pathname: string, headers = request.headers) {
    const url = request.nextUrl.clone()
    url.pathname = pathname
    return NextResponse.rewrite(url, { request: { headers: requestHeadersWithCurrentPath(request, headers) } })
}

function withRedirect(request: NextRequest, pathname: string) {
    const url = request.nextUrl.clone()
    url.pathname = pathname
    return NextResponse.redirect(url)
}

function isPlatformHost(domain: string) {
    if (["betelgeze.com", "www.betelgeze.com", APP_HOST, DASHBOARD_HOST, ONBOARDING_HOST, AUTH_HOST, "leadgen.betelgeze.com"].includes(domain)) return true
    if (!process.env.NEXT_PUBLIC_SITE_URL) return false
    return new URL(process.env.NEXT_PUBLIC_SITE_URL).hostname.toLowerCase() === domain
}

function shouldRefreshSessionForDomain(domain: string | null) {
    if (!domain) return false
    if (isPlatformHost(domain)) return true
    return domain === "localhost" || domain === "127.0.0.1" || domain === "::1"
}

function requestCurrentPath(request: NextRequest) {
    return `${request.nextUrl.pathname}${request.nextUrl.search}`
}

function requestHeadersWithCurrentPath(request: NextRequest, headers = request.headers) {
    const nextHeaders = new Headers(headers)
    nextHeaders.set("x-betelgeze-current-path", requestCurrentPath(request))
    return nextHeaders
}

function isAppHost(domain: string | null) {
    return domain === APP_HOST || domain === DASHBOARD_HOST
}

async function getCustomDomainWorkspace(domain: string) {
    const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!baseUrl || !anonKey) return null

    const requestOptions = {
        method: "POST",
        headers: {
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ requested_domain: domain }),
        cache: "no-store",
    } as const
    const response = await fetch(`${baseUrl}/rest/v1/rpc/resolve_workspace_public_domain`, requestOptions)
    if (response.ok) {
        const result = await response.json() as Array<{ workspace_slug?: string; domain_status?: string; surface?: string }>
        const workspace = result[0]
        return workspace?.workspace_slug
            ? { slug: workspace.workspace_slug, status: workspace.domain_status ?? "verified", surface: workspace.surface === "client_portal" ? "client_portal" as const : "onboarding" as const }
            : null
    }

    // Rolling-migration fallback keeps existing onboarding domains available
    // until the public-domain resolver migration reaches the database.
    const legacyResponse = await fetch(`${baseUrl}/rest/v1/rpc/resolve_workspace_onboarding_domain`, requestOptions)
    if (!legacyResponse.ok) return null
    const result = await legacyResponse.json() as Array<{ workspace_slug?: string; domain_status?: string }>
    const workspace = result[0]
    return workspace?.workspace_slug
        ? { slug: workspace.workspace_slug, status: workspace.domain_status ?? "verified", surface: "onboarding" as const }
        : null
}

export async function proxy(request: NextRequest) {
    const path = request.nextUrl.pathname
    const domain = requestHostname(request)
    // Refresh before constructing rewrites. Supabase may replace an expired
    // token, and those updated request cookies must be present in the headers
    // forwarded to the route that renders this same request.
    const sessionState = shouldRefreshSessionForDomain(domain)
        ? await refreshSession(request)
        : { response: NextResponse.next({ request: { headers: requestHeadersWithCurrentPath(request) } }), aal: null, userId: null }
    const sessionResponse = sessionState.response

    function withSession(response: NextResponse) {
        return carrySessionResponse(sessionResponse, response)
    }

    const isCentralAuthRoute = AUTH_PATHS.some((authPath) => path === authPath || path.startsWith(`${authPath}/`))
    if (domain && domain !== AUTH_HOST && isCentralAuthRoute && isPlatformHost(domain)) {
        const destination = new URL(path, authOrigin())
        destination.search = request.nextUrl.search
        return withSession(NextResponse.redirect(destination))
    }

    if ((domain === "betelgeze.com" || domain === "www.betelgeze.com") && path === "/" && (request.nextUrl.searchParams.has("code") || request.nextUrl.searchParams.has("token_hash"))) {
        const destination = new URL("/auth/callback", authOrigin())
        request.nextUrl.searchParams.forEach((value, key) => destination.searchParams.set(key, value))
        if (!destination.searchParams.has("next")) {
            const type = destination.searchParams.get("type")
            destination.searchParams.set("next", type === "recovery" ? "/forgot-password/new-password" : type === "signup" ? "/sign-up/about" : "/login")
        }
        return withSession(NextResponse.redirect(destination))
    }

    // Clean up legacy /dashboard links copied from old emails or browser state.
    // Workspace pages now live directly under /[workspaceSlug]/...
    if (isAppHost(domain)) {
        if (sessionState.userId && sessionState.aal !== "aal2") {
            const destination = new URL("/mfa", authOrigin())
            destination.searchParams.set("next", `https://${domain}${requestCurrentPath(request)}`)
            return withSession(NextResponse.redirect(destination))
        }
        if (path === "/dashboard") return withSession(withRedirect(request, "/workspaces"))
        if (path.startsWith("/dashboard/")) return withSession(withRedirect(request, path.slice("/dashboard".length)))
        if (path === "/leadgen" || path.startsWith("/leadgen/")) {
            return new NextResponse("Not Found", { status: 404 })
        }
        if (path === WORKSPACE_SHELL_INTERNAL_PREFIX || path.startsWith(`${WORKSPACE_SHELL_INTERNAL_PREFIX}/`)) {
            return new NextResponse("Not Found", { status: 404 })
        }

        const publicDashboardPaths = [
            "/login", "/sign-up", "/forgot-password", "/update-password",
            "/mfa", "/logout", "/privacy", "/users", "/invites", "/auth", "/workspaces", "/install",
            "/check-email", "/email-confirmed", "/session", "/onboarding", "/client-portal",
        ]
        const isPublicDashboardPath = publicDashboardPaths.some(
            (publicPath) => path === publicPath || path.startsWith(`${publicPath}/`)
        )
        const workspacePath = path.match(/^\/([a-z0-9][a-z0-9-]*)(?:\/(.*))?$/i)
        if (!isPublicDashboardPath && workspacePath) {
            const [, workspaceSlug] = workspacePath
            const headers = new Headers(request.headers)
            headers.set("x-betelgeze-workspace-slug", workspaceSlug)
            if (!request.nextUrl.searchParams.has(WORKSPACE_TAB_FRAME_PARAM) && workspaceRouteUsesShell(path)) {
                headers.set(WORKSPACE_SHELL_REQUEST_HEADER, "1")
                return withSession(withRewrite(request, workspaceShellRoute(workspaceSlug), headers))
            }
            return withSession(withRewrite(request, path, headers))
        }
        if (path === "/") return withSession(withRewrite(request, "/workspaces"))
    }

    if (domain === AUTH_HOST) {
        if (path === "/") return withSession(withRewrite(request, "/login"))
        if (!isAuthHostPath(path)) {
            const destination = new URL(`https://${APP_HOST}${path}`)
            destination.search = request.nextUrl.search
            return withSession(NextResponse.redirect(destination))
        }
    }

    if (domain === "leadgen.betelgeze.com") {
        if (isCentralAuthRoute) {
            const destination = new URL(path, authOrigin())
            destination.search = request.nextUrl.search
            return withSession(NextResponse.redirect(destination))
        }
        if (path === "/dashboard" || path.startsWith("/dashboard/")) {
            const destination = new URL(`https://${APP_HOST}${path === "/dashboard" ? "/workspaces" : path.slice("/dashboard".length)}`)
            destination.search = request.nextUrl.search
            return withSession(NextResponse.redirect(destination))
        }
        const workspacePath = path.match(/^\/([a-z0-9][a-z0-9-]*)(?:\/(.*))?$/i)
        if (workspacePath) {
            const destination = new URL(`https://${APP_HOST}/${workspacePath[1].toLowerCase()}/leadgen${workspacePath[2] ? `/${workspacePath[2].replace(/\/$/, "")}` : ""}`)
            destination.search = request.nextUrl.search
            return withSession(NextResponse.redirect(destination))
        }
        const destination = new URL(`https://${APP_HOST}/workspaces`)
        destination.search = request.nextUrl.search
        return withSession(NextResponse.redirect(destination))
    }

    if (domain === ONBOARDING_HOST) {
        if (path === "/sms-consent") {
            const headers = new Headers(request.headers)
            headers.set("x-betelgeze-custom-onboarding-domain", domain)
            return withSession(withRewrite(request, "/onboarding/sms-consent", headers))
        }
        const canonicalOnboarding = path.match(/^\/onboarding\/[a-z0-9][a-z0-9-]*\/([a-f0-9]{64})$/i)
        if (canonicalOnboarding) return withSession(withRedirect(request, `/${canonicalOnboarding[1]}`))

        const token = path.match(/^\/([a-f0-9]{64})$/i)
        if (token) {
            const headers = new Headers(request.headers)
            headers.set("x-betelgeze-custom-onboarding-domain", domain)
            return withSession(withRewrite(request, `/onboarding/session/${token[1]}`, headers))
        }
    }

    if (domain && !isPlatformHost(domain)) {
        const workspace = await getCustomDomainWorkspace(domain)
        if (workspace) {
            const customToken = path.match(/^\/([a-f0-9]{64})$/i)
            const platformSessionToken = path.match(/^\/onboarding\/session\/([a-f0-9]{64})$/i)
            const isDomainProbe = workspace.surface === "client_portal"
                ? request.nextUrl.searchParams.has("__betelgeze_client_portal_domain_probe")
                : request.nextUrl.searchParams.has("__betelgeze_domain_probe")
            if (!isDomainProbe && workspace.status !== "verified") {
                return new NextResponse("Not Found", { status: 404 })
            }
            if (workspace.surface === "onboarding" && path === "/sms-consent") {
                const headers = new Headers(request.headers)
                headers.set("x-betelgeze-workspace-slug", workspace.slug)
                headers.set("x-betelgeze-custom-onboarding-domain", domain)
                return withSession(withRewrite(request, "/onboarding/sms-consent", headers))
            }
            // Checkout sessions created before custom-domain return URLs were
            // canonicalized still point here. Preserve their query string and
            // move the browser to the public token route instead of 404ing.
            if (workspace.surface === "onboarding" && platformSessionToken) {
                return withSession(withRedirect(request, `/${platformSessionToken[1]}`))
            }
            if (!customToken) return new NextResponse("Not Found", { status: 404 })
            const headers = new Headers(request.headers)
            headers.set("x-betelgeze-workspace-slug", workspace.slug)
            headers.set(workspace.surface === "client_portal" ? "x-betelgeze-custom-client-portal-domain" : "x-betelgeze-custom-onboarding-domain", domain)
            const url = request.nextUrl.clone()
            url.pathname = workspace.surface === "client_portal"
                ? `/client-portal/session/${customToken[1]}`
                : `/onboarding/session/${customToken[1]}`
            return NextResponse.rewrite(url, { request: { headers } })
        }
    }

    return sessionResponse
}

export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"] }
