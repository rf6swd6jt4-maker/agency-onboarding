"use client"

import { createContext, useContext, type ReactNode } from "react"

type WorkspaceDocumentRuntimeValue = {
    active: boolean
    tabId: string
}

const WorkspaceDocumentRuntimeContext = createContext<WorkspaceDocumentRuntimeValue | null>(null)

export function WorkspaceDocumentRuntimeProvider({ active, children, tabId }: WorkspaceDocumentRuntimeValue & { children: ReactNode }) {
    return <WorkspaceDocumentRuntimeContext.Provider value={{ active, tabId }}>
        {children}
    </WorkspaceDocumentRuntimeContext.Provider>
}

export function useWorkspaceDocumentRuntime() {
    return useContext(WorkspaceDocumentRuntimeContext)
}
