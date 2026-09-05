"use client"

import { useEffect, useState } from "react"
import { WORKSPACE_TAB_FRAME_PARAM, WORKSPACE_TAB_VISIBILITY_EVENT } from "@/lib/workspace-tabs"

export { WORKSPACE_TAB_VISIBILITY_EVENT } from "@/lib/workspace-tabs"

function readActiveState() {
    const embedded = new URLSearchParams(window.location.search).has(WORKSPACE_TAB_FRAME_PARAM)
    if (embedded) return document.body.dataset.workspaceTabActive === "true"
    return document.body.dataset.workspaceTabsHosted !== "true"
}

export function useWorkspaceTabActive() {
    const [active, setActive] = useState(() => typeof window !== "undefined" && readActiveState())

    useEffect(() => {
        const update = () => setActive(readActiveState())
        update()
        window.addEventListener(WORKSPACE_TAB_VISIBILITY_EVENT, update)
        return () => window.removeEventListener(WORKSPACE_TAB_VISIBILITY_EVENT, update)
    }, [])

    return active
}
