import { Suspense } from "react"

import { CurrentPanelRouteLoading } from "@/components/workspace/CurrentPanelRouteLoading"
import { PanelRouteLoading } from "@/components/workspace/PanelRouteLoading"

export default function AdminLoading() {
    return <Suspense fallback={<PanelRouteLoading variant="admin" />}>
        <CurrentPanelRouteLoading variant="admin" />
    </Suspense>
}
