/* eslint-disable @next/next/no-img-element */

import type { CSSProperties } from "react"

import { createUploadSignedUrl } from "@/lib/onboarding/uploads"

type Props = {
    bannerPath: string | null
    logoPath: string | null
    name: string
    height: number
    position: number
}

export function WorkspaceBannerFallback({ bannerPath, logoPath, height }: Pick<Props, "bannerPath" | "logoPath" | "height">) {
    if (!bannerPath && !logoPath) return null
    if (!bannerPath) {
        return <div aria-hidden="true" className="mb-5 flex h-[112px] items-end sm:h-[108px]"><div className="h-[112px] w-[112px] animate-pulse rounded-full border-4 border-neutral-950 bg-neutral-900 sm:h-[108px] sm:w-[108px]" /></div>
    }
    return <div aria-hidden="true" className="relative mb-16 h-[calc(var(--workspace-banner-height)*0.6)] animate-pulse rounded-xl border border-neutral-800 bg-neutral-900 sm:h-[var(--workspace-banner-height)] sm:rounded-2xl" style={{ "--workspace-banner-height": `${height}px` } as CSSProperties}>{logoPath ? <div className="absolute bottom-0 left-4 h-[112px] w-[112px] translate-y-1/2 rounded-full border-4 border-neutral-950 bg-neutral-900 sm:left-7 sm:h-[108px] sm:w-[108px]" /> : null}</div>
}

export function WorkspaceBannerPending() {
    return <div aria-label="Loading workspace banner" aria-busy="true" className="relative mb-16 h-[115px] animate-pulse rounded-xl border border-neutral-800 bg-neutral-900 sm:h-48 sm:rounded-2xl">
        <div className="absolute bottom-0 left-4 h-[112px] w-[112px] translate-y-1/2 rounded-full border-4 border-neutral-950 bg-neutral-900 sm:left-7 sm:h-[108px] sm:w-[108px]" />
    </div>
}

export async function WorkspaceBanner({ bannerPath, logoPath, name, height, position }: Props) {
    if (!bannerPath && !logoPath) return null
    const [bannerSrc, logoSrc] = await Promise.all([
        bannerPath ? createUploadSignedUrl(bannerPath) : null,
        logoPath ? createUploadSignedUrl(logoPath) : null,
    ])

    if (!bannerSrc) return <div className="mb-5 flex h-[112px] items-end sm:h-[108px]"><img src={logoSrc!} alt={`${name} logo`} className="h-[112px] w-[112px] rounded-full border-4 border-neutral-950 bg-neutral-900 object-cover sm:h-[108px] sm:w-[108px]" /></div>

    return <div className="relative mb-16 h-[calc(var(--workspace-banner-height)*0.6)] overflow-visible rounded-xl border border-neutral-800 bg-neutral-900 sm:h-[var(--workspace-banner-height)] sm:rounded-2xl" style={{ "--workspace-banner-height": `${height}px` } as CSSProperties}><img src={bannerSrc} alt={`${name} dashboard banner`} className="h-full w-full rounded-xl object-cover sm:rounded-2xl" style={{ objectPosition: `50% ${position}%` }} />{logoSrc && <img src={logoSrc} alt={`${name} logo`} className="absolute bottom-0 left-4 h-[112px] w-[112px] translate-y-1/2 rounded-full border-4 border-neutral-950 bg-neutral-900 object-cover sm:left-7 sm:h-[108px] sm:w-[108px]" />}</div>
}
