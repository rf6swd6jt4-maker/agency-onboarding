import sharp from "sharp"
import { downloadOnboardingUpload } from "@/lib/onboarding/uploads"
import { supabaseAdmin } from "@/lib/supabase/admin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = {
    params: Promise<{
        username: string
    }>
}

export async function GET(_request: Request, context: RouteContext) {
    const { username } = await context.params
    const normalizedUsername = username.trim().toLowerCase()

    if (!/^[a-z0-9][a-z0-9-]{1,27}[a-z0-9]$/.test(normalizedUsername)) {
        return new Response("Avatar not found", { status: 404 })
    }

    const { data: profile } = await supabaseAdmin
        .from("user_profiles")
        .select("avatar_path")
        .eq("username", normalizedUsername)
        .maybeSingle()

    if (!profile?.avatar_path) {
        return new Response("Avatar not found", { status: 404 })
    }

    try {
        const upload = await downloadOnboardingUpload(profile.avatar_path)
        const image = await sharp(upload.bytes)
            .rotate()
            .resize(96, 96, { fit: "cover", position: "centre", withoutEnlargement: true })
            .webp({ quality: 80 })
            .toBuffer()

        return new Response(new Uint8Array(image), {
            headers: {
                "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
                "Content-Length": String(image.byteLength),
                "Content-Type": "image/webp",
                "X-Content-Type-Options": "nosniff",
            },
        })
    } catch {
        return new Response("Avatar not found", { status: 404 })
    }
}
