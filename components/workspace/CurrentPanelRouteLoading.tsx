"use client"

import { useSearchParams } from "next/navigation"

import { PanelRouteLoading, type PanelLoadingVariant } from "@/components/workspace/PanelRouteLoading"

export function CurrentPanelRouteLoading({ variant }: { variant: "admin" | "communications" }) {
    const searchParams = useSearchParams()
    let currentVariant: PanelLoadingVariant = variant

    if (variant === "admin" && searchParams.get("view") === "okrs") currentVariant = "admin-okrs"
    if (variant === "communications" && (
        searchParams.get("mode") === "team"
        || searchParams.has("dm")
        || searchParams.has("nativeConversation")
    )) currentVariant = "communications-team"

    return <PanelRouteLoading variant={currentVariant} />
}
