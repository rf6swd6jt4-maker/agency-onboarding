import { resolveClientBrandAsset, type ClientBrandingSurface } from "@/lib/client-branding/assets"
import { validateClientLogoSvg } from "@/lib/client-branding/svg"
import { downloadOnboardingUpload } from "@/lib/onboarding/uploads"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteProps = {
    params: Promise<{ surface: string; token: string }>
}
export async function GET(_request: Request, { params }: RouteProps) {
    const { surface, token } = await params
    if (surface !== "onboarding" && surface !== "client-portal" && surface !== "sms-opt-in") {
        return new Response("Not Found", { status: 404 })
    }
    const logo = await resolveClientBrandAsset(surface as ClientBrandingSurface, token, "logo")
    if (!logo) return new Response("Not Found", { status: 404 })

    try {
        const source = await downloadOnboardingUpload(logo.storagePath)
        const svg = validateClientLogoSvg(source.bytes)
        return new Response(svg, {
            headers: {
                "Content-Type": "image/svg+xml; charset=utf-8",
                "Cache-Control": "public, max-age=31536000, immutable",
                "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
                "X-Content-Type-Options": "nosniff",
            },
        })
    } catch {
        return new Response("Not Found", { status: 404 })
    }
}
