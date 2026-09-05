import { WorkspaceBannerPending } from "@/components/admin/WorkspaceBannerPending"
import { PanelRouteLoading, type PanelLoadingVariant } from "@/components/workspace/PanelRouteLoading"
import { DetailRouteLoading } from "@/components/workspace/DetailRouteLoading"
import { workspaceRouteUsesSharedBanner } from "@/lib/workspace-panel-chrome"
import { workspaceRouteIsRecordDetail } from "@/lib/workspace-tabs"
import type { WorkspaceDetailPreview } from "@/lib/workspace-detail-preview"

function panelLoadingForUrl(value: string, workspaceSlug: string): { variant: PanelLoadingVariant; title?: string } {
    const url = new URL(value, "http://localhost")
    const segments = url.pathname.split("/").filter(Boolean).slice(1)
    const [panel, nested] = segments

    if (workspaceRouteIsRecordDetail(value, workspaceSlug, "http://localhost")) return { variant: "detail" as const, title: panel?.replace(/-/g, " ") ?? "record" }
    if (panel === "admin") {
        if (nested === "activity") return { variant: "admin-activity" as const }
        if (nested === "maintenance") return { variant: "admin-maintenance" as const }
        if (!nested && url.searchParams.get("view") === "okrs") return { variant: "admin-okrs" as const }
        return { variant: "admin" as const }
    }
    if (panel === "leadgen") return { variant: nested === "polls" ? "leadgen-polls" as const : "leadgen" as const }
    if (panel === "communications" && (url.searchParams.get("mode") === "team" || url.searchParams.has("dm") || url.searchParams.has("nativeConversation"))) return { variant: "communications-team" as const }
    const variants: Record<string, PanelLoadingVariant> = {
        "appointment-setting": "appointment-setting",
        assets: "assets",
        communications: "communications",
        onboarding: "onboarding",
        relationships: "relationships",
        settings: "settings",
        work: "fulfilment",
        "work-items": "work-items",
    }
    return { variant: variants[panel] ?? "detail", title: panel?.replace(/-/g, " ") ?? "record" }
}

export function WorkspaceTabOpeningState({ url, workspaceSlug, detailPreview }: { url: string; workspaceSlug: string; detailPreview?: WorkspaceDetailPreview | null }) {
    const loading = panelLoadingForUrl(url, workspaceSlug)
    if (loading.variant === "detail") return <DetailRouteLoading title={loading.title ?? "record"} preview={detailPreview} />

    const pathname = new URL(url, "http://localhost").pathname
    return <div className="min-h-full bg-neutral-950">
        {workspaceRouteUsesSharedBanner(pathname) ? <div className="bg-neutral-950 px-4 text-white sm:px-6"><div className="mx-auto max-w-7xl pt-5"><WorkspaceBannerPending /></div></div> : null}
        <PanelRouteLoading variant={loading.variant} title={loading.title} />
    </div>
}
