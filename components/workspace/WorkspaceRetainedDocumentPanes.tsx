"use client"

import { Activity, useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { WorkspaceDocumentRuntimeProvider } from "@/components/workspace/WorkspaceDocumentRuntime"
import { WorkspaceTabOpeningState } from "@/components/workspace/WorkspaceTabOpeningState"
import type { WorkspaceDetailPreview } from "@/lib/workspace-detail-preview"

type RetainedTab = {
    id: string
    url: string
    detailPreview?: WorkspaceDetailPreview
}

type RetainedPane = {
    tabId: string
    url: string
    content: ReactNode
}

type Props = {
    activeTabId: string
    content: ReactNode
    contentOwnerTabId: string
    contentUrl: string
    currentDocumentUrl: string
    onPaneReady: (tabId: string, url: string) => void
    retainedTabIds: string[]
    tabs: RetainedTab[]
    workspaceSlug: string
}

function RouteReadinessObserver({ children, onReady }: { children: ReactNode; onReady: () => void }) {
    const rootRef = useRef<HTMLDivElement>(null)

    useLayoutEffect(() => {
        const root = rootRef.current
        if (!root) return
        let reported = false
        const check = () => {
            if (reported || root.querySelector("[data-workspace-route-loading]")) return
            reported = true
            onReady()
        }
        check()
        if (reported) return
        const observer = new MutationObserver(check)
        observer.observe(root, { attributes: true, childList: true, subtree: true })
        return () => observer.disconnect()
    }, [onReady])

    return <div ref={rootRef} className="contents">{children}</div>
}

function RetainedDocumentPane({ active, children, runtimeActive, tabId, url, onReady }: {
    active: boolean
    children: ReactNode
    runtimeActive: boolean
    tabId: string
    url: string
    onReady: (tabId: string, url: string) => void
}) {
    const reportReady = useCallback(() => onReady(tabId, url), [onReady, tabId, url])
    return <Activity name={`workspace-pane-${tabId}`} mode={active ? "visible" : "hidden"}>
        <WorkspaceDocumentRuntimeProvider tabId={tabId} active={runtimeActive}>
            <div
                data-workspace-document-pane
                data-workspace-pane-tab-id={tabId}
                aria-hidden={!active}
                className="absolute inset-0 overflow-y-auto overscroll-contain bg-neutral-950 [contain:layout_paint]"
            >
                <RouteReadinessObserver onReady={reportReady}>{children}</RouteReadinessObserver>
            </div>
        </WorkspaceDocumentRuntimeProvider>
    </Activity>
}

function StagedDocumentPane({ children, onReady, tabId }: { children: ReactNode; onReady: () => void; tabId: string }) {
    const observerRef = useRef<MutationObserver | null>(null)
    const assignRoot = useCallback((node: HTMLDivElement | null) => {
        observerRef.current?.disconnect()
        observerRef.current = null
        if (!node) return
        let reported = false
        const check = () => {
            if (reported || node.querySelector("[data-workspace-route-loading]")) return
            reported = true
            observerRef.current?.disconnect()
            observerRef.current = null
            onReady()
        }
        check()
        if (reported) return
        const observer = new MutationObserver(check)
        observerRef.current = observer
        observer.observe(node, { attributes: true, childList: true, subtree: true })
    }, [onReady])

    return <Activity name={`workspace-pane-${tabId}-staging`} mode="hidden">
        <WorkspaceDocumentRuntimeProvider tabId={tabId} active={false}>
            <div ref={assignRoot} data-workspace-pane-staging={tabId} className="absolute inset-0 overflow-hidden">{children}</div>
        </WorkspaceDocumentRuntimeProvider>
    </Activity>
}

export function WorkspaceRetainedDocumentPanes({
    activeTabId,
    content,
    contentOwnerTabId,
    contentUrl,
    currentDocumentUrl,
    onPaneReady,
    retainedTabIds,
    tabs,
    workspaceSlug,
}: Props) {
    const [retentionState, setRetentionState] = useState<{
        allowedKey: string
        content: ReactNode
        contentOwnerTabId: string
        contentUrl: string
        panes: RetainedPane[]
    }>(() => ({ allowedKey: "", content: null, contentOwnerTabId: "", contentUrl: "", panes: [] }))
    const openTabIds = useMemo(() => tabs.map((tab) => tab.id), [tabs])
    const allowedTabIds = useMemo(() => {
        const open = new Set(openTabIds)
        return [activeTabId, contentOwnerTabId, ...retainedTabIds]
            .filter((id, index, values) => Boolean(id) && open.has(id) && values.indexOf(id) === index)
    }, [activeTabId, contentOwnerTabId, openTabIds, retainedTabIds])
    const allowedKey = allowedTabIds.join("\u0000")
    const inputChanged = retentionState.allowedKey !== allowedKey
        || retentionState.content !== content
        || retentionState.contentOwnerTabId !== contentOwnerTabId
        || retentionState.contentUrl !== contentUrl
    let currentState = retentionState
    if (inputChanged) {
        const allowed = new Set(allowedTabIds)
        let panes = retentionState.panes.filter((pane) => allowed.has(pane.tabId))
        const existingIndex = panes.findIndex((pane) => pane.tabId === contentOwnerTabId)
        if (contentOwnerTabId && allowed.has(contentOwnerTabId) && existingIndex < 0) {
            panes = [...panes, { tabId: contentOwnerTabId, url: contentUrl, content }]
        } else if (existingIndex >= 0 && panes[existingIndex].content === content && panes[existingIndex].url !== contentUrl) {
            panes = panes.map((pane, index) => index === existingIndex ? { ...pane, url: contentUrl } : pane)
        }
        currentState = { allowedKey, content, contentOwnerTabId, contentUrl, panes }
        setRetentionState(currentState)
    }
    const panes = currentState.panes
    const paneByTabId = new Map(panes.map((pane) => [pane.tabId, pane]))
    const ownerPane = paneByTabId.get(contentOwnerTabId)
    const ownerNeedsStaging = Boolean(ownerPane && ownerPane.content !== content)

    const promoteStagedPane = useCallback(() => {
        if (!contentOwnerTabId) return
        setRetentionState((current) => {
            const existingIndex = current.panes.findIndex((pane) => pane.tabId === contentOwnerTabId)
            const promoted = { tabId: contentOwnerTabId, url: contentUrl, content }
            if (existingIndex < 0) return { ...current, panes: [...current.panes, promoted] }
            if (current.panes[existingIndex].content === content && current.panes[existingIndex].url === contentUrl) return current
            return { ...current, panes: current.panes.map((pane, index) => index === existingIndex ? promoted : pane) }
        })
        onPaneReady(contentOwnerTabId, contentUrl)
    }, [content, contentOwnerTabId, contentUrl, onPaneReady])

    const renderPaneByTabId = new Map(panes.map((pane) => [pane.tabId, pane]))
    if (contentOwnerTabId && !renderPaneByTabId.has(contentOwnerTabId)) {
        renderPaneByTabId.set(contentOwnerTabId, { tabId: contentOwnerTabId, url: contentUrl, content })
    }
    const orderedPaneIds = tabs.map((tab) => tab.id).filter((id) => allowedTabIds.includes(id) && renderPaneByTabId.has(id))
    const activePaneAvailable = orderedPaneIds.includes(activeTabId)
    const activeTab = tabs.find((tab) => tab.id === activeTabId)

    return <>
        {orderedPaneIds.map((tabId) => {
            const pane = renderPaneByTabId.get(tabId)!
            const active = tabId === activeTabId
            return <RetainedDocumentPane
                key={tabId}
                tabId={tabId}
                url={pane.url}
                active={active}
                runtimeActive={active && pane.url === currentDocumentUrl}
                onReady={ownerNeedsStaging && tabId === contentOwnerTabId ? () => undefined : onPaneReady}
            >
                {pane.content}
            </RetainedDocumentPane>
        })}
        {ownerNeedsStaging ? <StagedDocumentPane
            key={`${contentOwnerTabId}:${contentUrl}`}
            tabId={contentOwnerTabId}
            onReady={promoteStagedPane}
        >
            {content}
        </StagedDocumentPane> : null}
        {!activePaneAvailable && activeTab ? <div className="absolute inset-0 z-10 overflow-y-auto bg-neutral-950">
            <WorkspaceTabOpeningState url={activeTab.url} workspaceSlug={workspaceSlug} detailPreview={activeTab.detailPreview} />
        </div> : null}
    </>
}
