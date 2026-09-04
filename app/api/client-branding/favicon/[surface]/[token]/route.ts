import sharp from "sharp"
import { downloadOnboardingUpload } from "@/lib/onboarding/uploads"
import { resolveClientFavicon, type ClientBrandingSurface } from "@/lib/client-branding/favicon"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteProps = {
    params: Promise<{ surface: string; token: string }>
}

export async function GET(_request: Request, { params }: RouteProps) {
    const { surface, token } = await params
    if (surface !== "onboarding" && surface !== "client-portal" && surface !== "sms-opt-in") return new Response("Not Found", { status: 404 })

    const favicon = await resolveClientFavicon(surface as ClientBrandingSurface, token)
    if (!favicon) return new Response("Not Found", { status: 404 })

    try {
        const source = await downloadOnboardingUpload(favicon.storagePath)
        const image = await sharp(source.bytes)
            .rotate()
            .resize(64, 64, {
                fit: "contain",
                background: { r: 0, g: 0, b: 0, alpha: 0 },
            })
            .png()
            .toBuffer()
        return new Response(new Uint8Array(image), {
            headers: {
                "Content-Type": "image/png",
                "Cache-Control": "public, max-age=31536000, immutable",
                "X-Content-Type-Options": "nosniff",
            },
        })
    } catch {
        return new Response("Not Found", { status: 404 })
    }
}
