"use client"

import type { ReactNode } from "react"
import { usePathname } from "next/navigation"

import { workspaceRouteUsesSharedBanner } from "@/lib/workspace-panel-chrome"

export function WorkspacePanelChrome({ banner, children }: { banner: ReactNode; children: ReactNode }) {
    const pathname = usePathname()
    const showBanner = workspaceRouteUsesSharedBanner(pathname)

    return <>
        {showBanner ? <div data-workspace-shared-banner className="bg-neutral-950 px-4 text-white sm:px-6">
            <div className="mx-auto max-w-7xl pt-5">{banner}</div>
        </div> : null}
        {children}
    </>
}
