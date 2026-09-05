import { Suspense } from "react"

import { CurrentPanelRouteLoading } from "@/components/workspace/CurrentPanelRouteLoading"
import { PanelRouteLoading } from "@/components/workspace/PanelRouteLoading"

export default function CommunicationsLoading() {
    return <Suspense fallback={<PanelRouteLoading variant="communications" />}>
        <CurrentPanelRouteLoading variant="communications" />
    </Suspense>
}
