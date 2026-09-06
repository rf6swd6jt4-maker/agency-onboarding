"use client"

/* eslint-disable @next/next/no-img-element */

import Link from "next/link"
import dynamic from "next/dynamic"
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { AccountMenu } from "@/components/account/AccountMenu"
import { Avatar } from "@/components/account/Avatar"
import { LoadingOverlay } from "@/components/LoadingOverlay"
import { UnreadMessageCount } from "@/components/communications/UnreadMessageCount"
import { shortId } from "@/lib/ui/relative-time"
import type { WorkspaceCreateActionState } from "@/app/[workspaceSlug]/relationships/actions"
import { WorkspaceTabBridge } from "@/components/workspace/WorkspaceTabBridge"
import { WorkspaceSuccessNotice } from "@/components/workspace/WorkspaceSuccessNotice"
import { WorkspaceTabOpeningState } from "@/components/workspace/WorkspaceTabOpeningState"
import { WORKSPACE_TAB_VISIBILITY_EVENT } from "@/components/workspace/useWorkspaceTabActive"
import { LEADGEN_POLLING_SYSTEM_VERSION_LABEL } from "@/lib/leadgen/version"
import { createSupabaseBrowserClient } from "@/lib/supabase/browser"
import { ONBOARDING_BUILDER_WINDOW_SOURCE, openOnboardingBuilderWindow, type OnboardingBuilderWindowSignal } from "@/lib/onboarding-builder-window"
import { canAccessPrivateWorkspacePanels, canAccessWorkspacePanel, canAccessWorkspaceUrl, WORKSPACE_PANELS, workspacePanelHref, type WorkspacePanelKey } from "@/lib/workspace-panels"
import type { WorkspaceCapability } from "@/lib/workspace-capabilities"
import type { WorkspaceRole } from "@/lib/workspaces"
import { WORKSPACE_MEMBER_PROFILE_EVENT, WORKSPACE_MEMBER_PROFILE_MESSAGE_SOURCE } from "@/lib/workspace-member-profile"
import { parseWorkspaceDetailPreview, storeWorkspaceDetailPreview, type WorkspaceDetailPreview } from "@/lib/workspace-detail-preview"
import { WORKSPACE_COMPOSER_FOCUS_EVENT, type WorkspaceComposerFocusEventDetail } from "@/lib/workspace-composer-viewport"
import { visibleWorkspacePresence, workspacePresenceRoster, workspacePresenceTopic, type WorkspacePresenceMember, type WorkspacePresencePayload, type WorkspacePresenceRosterMember, type WorkspacePresenceState } from "@/lib/workspace-presence"
import {
    WORKSPACE_MUTATION_END,
    WORKSPACE_MUTATION_START,
    type WorkspaceMutationEventDetail,
} from "@/lib/workspace-mutations"
import {
    appendWorkspaceTabHistory,
    isWorkspaceOnboardingBuilderUrl,
    isReopenClosedTabShortcut,
    normalizeWorkspaceTabCustomTitle,
    normalizeWorkspaceUrl as normalizeWorkspaceRoute,
    orderWorkspaceTabsByStableIds,
    reorderWorkspaceTabs,
    WORKSPACE_TAB_FRAME_NAME_PREFIX,
    WORKSPACE_TAB_FRAME_PARAM,
    WORKSPACE_TAB_MESSAGE_SOURCE,
    workspaceTabContextStorageKey,
    workspaceTabFrameMatchesUrl,
    workspaceTabHistoryStep,
    workspaceTabFrameUrl,
    workspaceTabIsCommunications,
    workspaceRouteCanShowRelationshipContext,
    workspaceRouteIsRecordDetail,
    workspaceTabTitleForUrl,
    workspaceTabDisplayTitle,
    type WorkspaceTabRecordTitle,
    type WorkspaceInitialTab,
    type WorkspaceTabFrameMessage,
    type WorkspaceTabParentMessage,
    type WorkspaceTabRelationshipContext,
} from "@/lib/workspace-tabs"
import { persistWorkspaceLaunchHint, workspaceLaunchUrlForRestore, type WorkspaceShellBootstrapTiming } from "@/lib/workspace-launch"
import { markWorkspaceLaunch, reportWorkspaceLaunch } from "@/lib/workspace-launch-performance"
import type { WorkspaceCreateTarget } from "@/components/workspace/WorkspaceCreateModal"

const WorkspaceMemberProfileModal = dynamic(() => import("@/components/workspace/WorkspaceMemberProfileModal").then((module) => module.WorkspaceMemberProfileModal))
const WorkspaceCreateModal = dynamic(() => import("@/components/workspace/WorkspaceCreateModal").then((module) => module.WorkspaceCreateModal))
const ShellRelationshipContextPanel = dynamic(() => import("@/components/workspace/ShellRelationshipContextPanel").then((module) => module.ShellRelationshipContextPanel))

const sidebarStorageKey = "betelgeze:workspace-sidebar-open"
const WORKSPACE_KEYBOARD_MOTION_MS = 300
// Mobile Safari continues resizing its browser chrome after the keyboard itself
// has finished. Keep the known resting edge until that secondary resize settles.
const WORKSPACE_KEYBOARD_SETTLE_MS = WORKSPACE_KEYBOARD_MOTION_MS + 340
const MAX_RESIDENT_WORKSPACE_FRAMES = 3
const WORKSPACE_SOFT_NAVIGATION_FALLBACK_MS = 8_000
const WORKSPACE_KEYBOARD_MINIMUM_SHIFT_PX = 64
type WorkspacePresenceChannel = ReturnType<ReturnType<typeof createSupabaseBrowserClient>["channel"]>

type WorkspaceTab = {
    id: string
    title: string
    customTitle?: string
    recordTitle?: WorkspaceTabRecordTitle
    url: string
    history: string[]
    historyIndex: number
    seenRevision: number
    detailPreview?: WorkspaceDetailPreview
}

type WorkspaceTabsState = {
    activeId: string
    mode?: "live"
    tabs: WorkspaceTab[]
}

type ClosedWorkspaceTab = {
    tab: WorkspaceTab
    index: number
}

type WorkspaceTabDragPreview = {
    left: number
    width: number
    title: string
    active: boolean
}

type WorkspaceTabContextStatus = {
    supported: boolean
    relationshipId: string | null
    context: WorkspaceTabRelationshipContext | null
}

type WorkspaceTabNavigationState = {
    status: "loading" | "error"
    requestedUrl: string
    error?: string
}

type Props = {
    workspace: { id: string; name: string; slug: string }
    initialWorkspaceUrl?: string
    initialTab: WorkspaceInitialTab
    launchServerTiming?: WorkspaceShellBootstrapTiming
    currentUserId: string
    username: string
    avatarSrc?: string | null
    workspaceRole: WorkspaceRole
    workspaceCapabilities: WorkspaceCapability[]
    leaveAction: (formData: FormData) => void
    createRelationshipAction: (formData: FormData) => Promise<WorkspaceCreateActionState>
    createWorkItemAction: (formData: FormData) => Promise<WorkspaceCreateActionState>
    createAssetAction: (formData: FormData) => Promise<WorkspaceCreateActionState>
    createOkrAction: (formData: FormData) => Promise<WorkspaceCreateActionState>
}

type SearchResult = {
    id: string
    type: string
    label: string
    description: string
    href: string
    hubHref?: string
    path?: string
    recordId?: string
}

type CreationNotice = {
    label: string
    href: string
}

function WorkspaceLogo({ src, name }: { src?: string | null; name: string }) {
    if (src) {
        return <img src={src} alt={`${name} logo`} className="h-9 w-9 shrink-0 rounded-full border border-neutral-700 bg-neutral-900 object-cover" />
    }

    return <div aria-label={`${name} logo`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900 text-sm font-semibold text-neutral-200">{name.slice(0, 1).toUpperCase()}</div>
}

function WorkspaceMutationStatus({ state, error }: { state: "idle" | "saving" | "saved" | "error"; error?: string | null }) {
    if (state === "idle") return null
    const label = state === "saving" ? "Saving…" : state === "saved" ? "Saved" : error || "Save failed"
    return <span aria-live="polite" title={error ?? undefined} className={`hidden shrink-0 text-[11px] md:inline ${state === "error" ? "text-red-300" : "text-neutral-500"}`}>{label}</span>
}

function WorkspacePresenceAvatars({ members, state, error, onOpenProfile }: { members: WorkspacePresenceRosterMember[]; state: WorkspacePresenceState; error: string | null; onOpenProfile: (userId: string) => void }) {
    if (!members.length) {
        if (state === "live") return null
        const label = state === "connecting" ? "Workspace presence connecting" : state === "reconnecting" ? "Workspace presence reconnecting" : error || "Workspace presence offline"
        return <span aria-label={label} title={label} className={`h-2.5 w-2.5 shrink-0 rounded-full ${state === "connecting" || state === "reconnecting" ? "animate-pulse bg-amber-400" : "bg-red-400"}`} />
    }
    return <div aria-label="Workspace team presence" className="flex shrink-0 items-center -space-x-1.5">
        {members.map((member, index) => <button data-icon-button type="button" key={member.id} onClick={() => onOpenProfile(member.id)} aria-label={`Open ${member.name} profile`} title={`${member.name} — ${member.active ? "Connected" : "Disconnected"}`} className="relative h-[30px] w-[30px] shrink-0 aspect-square overflow-hidden rounded-full border-2 border-neutral-950 bg-neutral-900 p-0 outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 md:h-7 md:w-7" style={{ zIndex: index + 1 }}>
            <span className={`block h-full w-full ${member.active ? "" : "grayscale opacity-35"}`}><Avatar src={member.avatarSrc} name={member.name} className="h-full w-full" /></span>
        </button>)}
        {state !== "live" ? <span aria-label="Workspace presence reconnecting" title={error || "Workspace presence reconnecting"} className="ml-2 h-2 w-2 animate-pulse rounded-full bg-amber-400" /> : null}
    </div>
}

function ArrowLeftIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2 md:h-4 md:w-4"><path d="m15 6-6 6 6 6" /></svg>
}

function ArrowRightIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2 md:h-4 md:w-4"><path d="m9 6 6 6-6 6" /></svg>
}

function ReloadIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2 md:h-4 md:w-4"><path d="M20 11a8 8 0 0 0-14.8-3" /><path d="M4 13a8 8 0 0 0 14.8 3" /><path d="M5 4v5h5" /><path d="M19 20v-5h-5" /></svg>
}

function SidebarIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2 md:h-4 md:w-4"><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M9 5v14" /></svg>
}

function ContextPanelIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2 md:h-4 md:w-4"><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M15 5v14" /></svg>
}

function SearchIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2 md:h-4 md:w-4"><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg>
}

function SearchResultContent({ item, mobile = false }: { item: SearchResult; mobile?: boolean }) {
    return (
        <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
                <p className="truncate text-sm font-medium text-neutral-100">{item.label}</p>
                {item.path && <p className="mt-0.5 truncate text-[11px] text-neutral-400">{item.path}</p>}
                <p className={`mt-0.5 text-xs text-neutral-500 ${mobile ? "line-clamp-2" : "truncate"}`}>{item.description}</p>
                {item.recordId && <p className="mt-1 truncate font-mono text-[10px] text-neutral-600">{shortId(item.recordId)}</p>}
            </div>
            <span className="shrink-0 rounded-full bg-neutral-900 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500">{item.type}</span>
        </div>
    )
}

function HomeIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2 md:h-4 md:w-4"><path d="m4 11 8-7 8 7" /><path d="M6 10v9h12v-9" /></svg>
}

function RelationshipsIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2 md:h-4 md:w-4"><path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /><path d="M16 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /><path d="M3 21a5 5 0 0 1 10 0" /><path d="M12 21a5 5 0 0 1 9 0" /></svg>
}

function WorkIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2 md:h-4 md:w-4"><path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="m3 6 .8.8L5.5 5" /><path d="m3 12 .8.8 1.7-1.8" /><path d="m3 18 .8.8 1.7-1.8" /></svg>
}

function AppointmentIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2 md:h-4 md:w-4"><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /><path d="m9 15 2 2 4-4" /></svg>
}

function AssetsIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2 md:h-4 md:w-4"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8" cy="10" r="1.5" /><path d="m4 17 5-5 4 4 2-2 5 5" /></svg>
}

function OkrIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2 md:h-4 md:w-4"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="m14 10 6-6" /><path d="M16 4h4v4" /></svg>
}

function LibraryIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2 md:h-4 md:w-4"><path d="M5 4v16" /><path d="M10 4v16" /><path d="m15 5 3-1 3 15-3 1-3-15Z" /></svg>
}

function BuilderIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2 md:h-4 md:w-4"><path d="M4 5h16v14H4z" /><path d="M8 9h8" /><path d="M8 13h5" /><path d="M17 12v5" /><path d="M14.5 14.5h5" /></svg>
}

function CommunicationsIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2 md:h-4 md:w-4"><path d="M5 7h14" /><path d="M5 12h9" /><path d="M5 17h6" /><path d="M4 4h16v11a3 3 0 0 1-3 3H9l-5 3V4Z" /></svg>
}

function LeadIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2 md:h-4 md:w-4"><path d="M4 19V5" /><path d="M4 19h16" /><path d="m7 15 4-4 3 3 5-7" /></svg>
}

function AdminIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2 md:h-4 md:w-4"><path d="M12 3 5 6v5c0 4.7 2.8 8 7 10 4.2-2 7-5.3 7-10V6l-7-3Z" /><path d="M9 12h6" /><path d="M12 9v6" /></svg>
}

function SettingsIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2 md:h-4 md:w-4"><circle cx="12" cy="12" r="3" /><path d="M12 3v3" /><path d="M12 18v3" /><path d="M3 12h3" /><path d="M18 12h3" /><path d="m5.6 5.6 2.1 2.1" /><path d="m16.3 16.3 2.1 2.1" /><path d="m18.4 5.6-2.1 2.1" /><path d="m7.7 16.3-2.1 2.1" /></svg>
}

function workspacePanelIcon(key: WorkspacePanelKey) {
    if (key === "relationships") return <RelationshipsIcon />
    if (key === "onboarding") return <HomeIcon />
    if (key === "fulfilment") return <WorkIcon />
    if (key === "appointment-setting") return <AppointmentIcon />
    if (key === "communications") return <CommunicationsIcon />
    if (key === "library") return <LibraryIcon />
    if (key === "onboarding-builder") return <BuilderIcon />
    if (key === "leadgen") return <LeadIcon />
    if (key === "admin") return <AdminIcon />
    return <SettingsIcon />
}

function createTabId() {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function deferNavigationStateUpdate(update: () => void) {
    queueMicrotask(update)
}

function WorkspaceTabFrame({ tab, active, assignRef, onLoad }: {
    tab: WorkspaceTab
    active: boolean
    assignRef: (tabId: string, node: HTMLIFrameElement | null) => void
    onLoad: () => void
}) {
    const [src] = useState(() => workspaceTabFrameUrl(tab.url, tab.id, "http://localhost"))
    const frameRef = useCallback((node: HTMLIFrameElement | null) => assignRef(tab.id, node), [assignRef, tab.id])

    return <iframe
        ref={frameRef}
        name={`${WORKSPACE_TAB_FRAME_NAME_PREFIX}${tab.id}`}
        src={src}
        aria-label={`${workspaceTabDisplayTitle(tab)} workspace tab`}
        hidden={!active}
        aria-hidden={!active}
        onLoad={onLoad}
        className="absolute inset-0 h-full w-full border-0 bg-neutral-950"
    />
}

export function WorkspaceTopBarClient(props: Props) {
    const searchParams = useSearchParams()
    const tabId = searchParams.get(WORKSPACE_TAB_FRAME_PARAM)

    if (tabId) return <WorkspaceTabBridge tabId={tabId} workspaceSlug={props.workspace.slug} />
    return <WorkspaceTabsShell {...props} />
}

function WorkspaceTabsShell({ workspace, initialWorkspaceUrl, initialTab, launchServerTiming, currentUserId, username, avatarSrc, workspaceRole, workspaceCapabilities, leaveAction, createRelationshipAction, createWorkItemAction, createAssetAction, createOkrAction }: Props) {
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const searchMenuId = useId()
    const desktopSearchRef = useRef<HTMLDivElement>(null)
    const desktopSearchInputRef = useRef<HTMLInputElement>(null)
    const mobileSearchRef = useRef<HTMLDivElement>(null)
    const mobileSearchInputRef = useRef<HTMLInputElement>(null)
    const sidebarTransitionTimeout = useRef<number | null>(null)
    const activeTabIdRef = useRef(initialTab.id)
    const tabsRef = useRef<WorkspaceTab[]>([initialTab])
    const tabsBootstrappedRef = useRef(false)
    const shellRootRef = useRef<HTMLDivElement>(null)
    const tabStripRef = useRef<HTMLDivElement>(null)
    const tabFrameOrderRef = useRef<string[]>([initialTab.id])
    const iframeRefs = useRef(new Map<string, HTMLIFrameElement>())
    const loadedTabIdsRef = useRef(new Set<string>())
    // An iframe's load event fires before its React effects have necessarily
    // installed WorkspaceTabBridge's message listener. Keep that distinction:
    // posting a navigation message in that window loses it and strands the
    // shell behind its loading overlay until the user tries again.
    const readyTabIdsRef = useRef(new Set<string>())
    const pendingNavigationRef = useRef(new Map<string, string>())
    const navigationFallbackRef = useRef(new Map<string, WorkspaceTab>())
    const navigationTimeoutRef = useRef(new Map<string, number>())
    const softNavigationFallbackRef = useRef(new Map<string, number>())
    const navigationErrorRef = useRef(new Set<string>())
    const closedTabsRef = useRef<ClosedWorkspaceTab[]>([])
    const canAddTabRef = useRef(true)
    const mutationRevisionRef = useRef(0)
    const mutationIdsByTabRef = useRef(new Map<string, Set<string>>())
    const presenceSessionIdRef = useRef("")
    const presenceChannelRef = useRef<WorkspacePresenceChannel | null>(null)
    const presenceStateRef = useRef<WorkspacePresenceState>("connecting")
    const tabButtonRefs = useRef(new Map<string, HTMLButtonElement>())
    const tabWarmTimeoutRef = useRef<number | null>(null)
    const tabWarmTargetRef = useRef("")
    const dragCleanupRef = useRef<(() => void) | null>(null)
    const dragStartedTabIdRef = useRef("")
    const suppressTabClickRef = useRef("")
    const tabTitleInputRef = useRef<HTMLInputElement>(null)
    const lastTouchTabTapRef = useRef({ tabId: "", time: 0 })
    const createIntentHandledRef = useRef("")
    const contextStatusByTabRef = useRef<Record<string, WorkspaceTabContextStatus>>({})
    const contextManualClosedByTabRef = useRef<Record<string, boolean>>({})
    const contextObstructedByTabRef = useRef<Record<string, boolean>>({})
    const creationNoticeTimeoutRef = useRef<number | null>(null)
    const shellSecondaryRequestedRef = useRef(false)
    const launchUsableReportedRef = useRef(false)
    const workspaceMembersRef = useRef<Array<{ id: string; name: string; avatarSrc: string | null }>>([
        { id: currentUserId, name: username, avatarSrc: avatarSrc ?? null },
    ])
    const presenceIdentityRef = useRef({ name: username, avatarSrc: avatarSrc ?? null })
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const [sidebarHydrated, setSidebarHydrated] = useState(false)
    const [sidebarTransitionEnabled, setSidebarTransitionEnabled] = useState(false)
    const [tabsHydrated, setTabsHydrated] = useState(false)
    const [loadedTabIds, setLoadedTabIds] = useState<Set<string>>(() => new Set())
    const [residentTabIds, setResidentTabIds] = useState<string[]>([initialTab.id])
    const [tabs, setTabs] = useState<WorkspaceTab[]>([initialTab])
    const [tabFrameOrder, setTabFrameOrder] = useState<string[]>([initialTab.id])
    const [activeTabId, setActiveTabId] = useState(initialTab.id)
    const [canAddTab, setCanAddTab] = useState(true)
    const [draggingTabId, setDraggingTabId] = useState<string | null>(null)
    const [tabDragPreview, setTabDragPreview] = useState<WorkspaceTabDragPreview | null>(null)
    const [editingTabId, setEditingTabId] = useState<string | null>(null)
    const [editingTabTitle, setEditingTabTitle] = useState("")
    const [contextOpenByTab, setContextOpenByTab] = useState<Record<string, boolean>>({})
    const [contextStatusByTab, setContextStatusByTab] = useState<Record<string, WorkspaceTabContextStatus>>({})
    const [contextObstructedByTab, setContextObstructedByTab] = useState<Record<string, boolean>>({})
    const [routeLoadingTabId, setRouteLoadingTabId] = useState<string | null>(null)
    const [refreshingTabIds, setRefreshingTabIds] = useState<Set<string>>(() => new Set())
    const [navigationStateByTab, setNavigationStateByTab] = useState<Record<string, WorkspaceTabNavigationState>>({})
    const [backgroundMutationCounts, setBackgroundMutationCounts] = useState<Record<string, number>>({})
    const [backgroundMutationState, setBackgroundMutationState] = useState<"idle" | "saving" | "saved" | "error">("idle")
    const [backgroundMutationError, setBackgroundMutationError] = useState<string | null>(null)
    const [activeWorkspaceUsers, setActiveWorkspaceUsers] = useState<WorkspacePresenceMember[]>([])
    const [presenceState, setPresenceState] = useState<WorkspacePresenceState>("connecting")
    const [presenceError, setPresenceError] = useState<string | null>(null)
    const [query, setQuery] = useState("")
    const [searchOpen, setSearchOpen] = useState(false)
    const [searchLoading, setSearchLoading] = useState(false)
    const [searchResults, setSearchResults] = useState<SearchResult[]>([])
    const [searchShortcutLabel, setSearchShortcutLabel] = useState("Ctrl+J")
    const [createTarget, setCreateTarget] = useState<"relationship" | "work-item" | "asset" | "okr" | null>(null)
    const [creationNotice, setCreationNotice] = useState<CreationNotice | null>(null)
    const [profileUserId, setProfileUserId] = useState<string | null>(null)
    const [communicationsUnreadCount, setCommunicationsUnreadCount] = useState(0)
    const [workspaceLogoSrc, setWorkspaceLogoSrc] = useState<string | null>(null)
    const [email, setEmail] = useState("")
    const [workspaceMembers, setWorkspaceMembers] = useState<Array<{ id: string; name: string; avatarSrc: string | null }>>([
        { id: currentUserId, name: username, avatarSrc: avatarSrc ?? null },
    ])
    const [initialPanelReady, setInitialPanelReady] = useState(false)
    const defaultWorkspaceUrl = `/${workspace.slug}`
    const tabsStorageKey = `betelgeze:workspace-tabs:${workspace.slug}`
    const capabilitySet = new Set(workspaceCapabilities)
    const canOpenWorkspaceUrl = useCallback((value: string) => canAccessWorkspaceUrl(value, workspace.slug, workspaceRole, workspaceCapabilities), [workspace.slug, workspaceRole, workspaceCapabilities])
    const activateWorkspaceTab = useCallback((tabId: string) => {
        setResidentTabIds((current) => {
            const next = [tabId, ...current.filter((id) => id !== tabId)].slice(0, MAX_RESIDENT_WORKSPACE_FRAMES)
            return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next
        })
        setActiveTabId(tabId)
    }, [])
    const warmWorkspaceTab = useCallback((tabId: string) => {
        const activeId = activeTabIdRef.current
        if (!tabId || tabId === activeId || !tabsRef.current.some((tab) => tab.id === tabId)) return
        setResidentTabIds((current) => {
            const next = [activeId, tabId, ...current]
                .filter((id, index, values) => Boolean(id) && values.indexOf(id) === index)
                .slice(0, MAX_RESIDENT_WORKSPACE_FRAMES)
            return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next
        })
    }, [])
    const cancelScheduledTabWarm = useCallback((tabId: string) => {
        if (tabWarmTargetRef.current !== tabId) return
        if (tabWarmTimeoutRef.current) window.clearTimeout(tabWarmTimeoutRef.current)
        tabWarmTimeoutRef.current = null
        tabWarmTargetRef.current = ""
    }, [])
    const scheduleTabWarm = useCallback((tabId: string) => {
        if (tabId === activeTabIdRef.current || residentTabIds.includes(tabId)) return
        if (tabWarmTimeoutRef.current) window.clearTimeout(tabWarmTimeoutRef.current)
        tabWarmTargetRef.current = tabId
        tabWarmTimeoutRef.current = window.setTimeout(() => {
            tabWarmTimeoutRef.current = null
            tabWarmTargetRef.current = ""
            warmWorkspaceTab(tabId)
        }, 60)
    }, [residentTabIds, warmWorkspaceTab])

    useEffect(() => {
        if (!tabsHydrated || tabs.length < 2 || !loadedTabIds.has(activeTabId)) return
        const activeIndex = tabs.findIndex((tab) => tab.id === activeTabId)
        if (activeIndex < 0) return
        const candidates = [tabs[activeIndex + 1], tabs[activeIndex - 1]].filter((tab): tab is WorkspaceTab => Boolean(tab))
        const candidate = candidates.find((tab) => !residentTabIds.includes(tab.id))
        if (!candidate) return
        const warm = () => warmWorkspaceTab(candidate.id)
        const requestIdle = window.requestIdleCallback
        if (typeof requestIdle === "function") {
            const idleId = requestIdle(warm, { timeout: 900 })
            return () => window.cancelIdleCallback(idleId)
        }
        const timeout = window.setTimeout(warm, 180)
        return () => window.clearTimeout(timeout)
    }, [activeTabId, loadedTabIds, residentTabIds, tabs, tabsHydrated, warmWorkspaceTab])

    useEffect(() => {
        const openFromEvent = (event: Event) => {
            const detail = (event as CustomEvent<{ userId?: string }>).detail
            if (detail?.userId && workspaceMembers.some((member) => member.id === detail.userId)) setProfileUserId(detail.userId)
        }
        const openFromFrame = (event: MessageEvent) => {
            if (event.origin !== window.location.origin || event.source === window) return
            const message = event.data as { source?: string; userId?: string } | null
            if (message?.source === WORKSPACE_MEMBER_PROFILE_MESSAGE_SOURCE && message.userId && workspaceMembers.some((member) => member.id === message.userId)) setProfileUserId(message.userId)
        }
        window.addEventListener(WORKSPACE_MEMBER_PROFILE_EVENT, openFromEvent)
        window.addEventListener("message", openFromFrame)
        return () => {
            window.removeEventListener(WORKSPACE_MEMBER_PROFILE_EVENT, openFromEvent)
            window.removeEventListener("message", openFromFrame)
        }
    }, [workspaceMembers])

    useEffect(() => {
        if (!initialPanelReady || shellSecondaryRequestedRef.current) return
        shellSecondaryRequestedRef.current = true
        const controller = new AbortController()
        void (async () => {
            let attempt = 0
            const retryDelays = [900, 3_000, 10_000, 30_000]
            while (!controller.signal.aborted) {
                try {
                    const response = await fetch(`/api/workspaces/${encodeURIComponent(workspace.slug)}/shell-secondary`, { signal: controller.signal })
                    const result = await response.json().catch(() => null) as { email?: string; workspaceLogoSrc?: string | null; workspaceMembers?: Array<{ id: string; name: string; avatarSrc: string | null }> } | null
                    if (!response.ok || !result) throw new Error("Could not load workspace shell details.")
                    if (typeof result.email === "string") setEmail(result.email)
                    if (typeof result.workspaceLogoSrc === "string") setWorkspaceLogoSrc(result.workspaceLogoSrc)
                    if (Array.isArray(result.workspaceMembers) && result.workspaceMembers.length) {
                        workspaceMembersRef.current = result.workspaceMembers
                        const currentMember = result.workspaceMembers.find((member) => member.id === currentUserId)
                        if (currentMember) presenceIdentityRef.current = { name: currentMember.name, avatarSrc: currentMember.avatarSrc }
                        setWorkspaceMembers(result.workspaceMembers)
                    }
                    return
                } catch {
                    if (controller.signal.aborted) return
                    const delay = retryDelays[Math.min(attempt, retryDelays.length - 1)]
                    attempt += 1
                    await new Promise((resolve) => window.setTimeout(resolve, delay))
                }
            }
        })()
        return () => controller.abort()
    }, [currentUserId, initialPanelReady, workspace.slug])

    useEffect(() => {
        if (!presenceSessionIdRef.current) presenceSessionIdRef.current = crypto.randomUUID()
        const heartbeat = () => void fetch(`/api/workspaces/${encodeURIComponent(workspace.slug)}/activity/presence`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state: "heartbeat", sessionId: presenceSessionIdRef.current }),
            keepalive: true,
        }).catch(() => undefined)
        heartbeat()
        const interval = window.setInterval(heartbeat, 60_000)
        const onVisibility = () => { if (document.visibilityState === "visible") heartbeat() }
        document.addEventListener("visibilitychange", onVisibility)
        return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", onVisibility) }
    }, [workspace.slug])

    const normalizeWorkspaceUrl = useCallback((value: string) => {
        return normalizeWorkspaceRoute(value, workspace.slug, window.location.origin)
    }, [workspace.slug])

    const titleForUrl = useCallback((url: string) => {
        return workspaceTabTitleForUrl(url, workspace.slug)
    }, [workspace.slug])

    const routeCanShowRelationshipContext = useCallback((url: string) => {
        return workspaceRouteCanShowRelationshipContext(url, workspace.slug, window.location.origin)
    }, [workspace.slug])

    const saveTabsState = useCallback((nextTabs: WorkspaceTab[], nextActiveId: string) => {
        sessionStorage.setItem(tabsStorageKey, JSON.stringify({ mode: "live", tabs: nextTabs, activeId: nextActiveId }))
        const active = nextTabs.find((tab) => tab.id === nextActiveId)
        if (active) {
            const restoreUrl = workspaceLaunchUrlForRestore(active.url, workspace.slug) ?? active.url
            const restoreTab = nextTabs.find((tab) => tab.url === restoreUrl) ?? active
            persistWorkspaceLaunchHint({ workspaceSlug: workspace.slug, tabId: restoreTab.id, url: restoreUrl })
        }
    }, [tabsStorageKey, workspace.slug])

    const showCreationNotice = useCallback((notice: CreationNotice) => {
        if (creationNoticeTimeoutRef.current) window.clearTimeout(creationNoticeTimeoutRef.current)
        setCreationNotice(notice)
        creationNoticeTimeoutRef.current = window.setTimeout(() => {
            setCreationNotice(null)
            creationNoticeTimeoutRef.current = null
        }, 8400)
    }, [])

    useEffect(() => () => {
        if (creationNoticeTimeoutRef.current) window.clearTimeout(creationNoticeTimeoutRef.current)
    }, [])

    const updateTabForShellNavigation = useCallback((tabId: string, url: string, detailPreview?: WorkspaceDetailPreview) => {
        setTabs((existingTabs) => {
            let changed = false
            const updatedTabs = existingTabs.map((tab) => {
                if (tab.id !== tabId) return tab
                if (tab.url === url && tab.history[tab.historyIndex] === url && (!detailPreview || tab.detailPreview === detailPreview)) return tab
                const nextHistory = tab.history[tab.historyIndex] === url
                    ? { history: tab.history, historyIndex: tab.historyIndex }
                    : appendWorkspaceTabHistory(tab.history, tab.historyIndex, url)
                changed = true
                return { ...tab, url, title: titleForUrl(url), detailPreview: detailPreview ?? (tab.url === url ? tab.detailPreview : undefined), ...nextHistory }
            })
            if (changed) saveTabsState(updatedTabs, activeTabIdRef.current || tabId)
            return changed ? updatedTabs : existingTabs
        })
    }, [saveTabsState, titleForUrl])

    const completeTabNavigation = useCallback((tabId: string) => {
        const softFallback = softNavigationFallbackRef.current.get(tabId)
        if (softFallback) window.clearTimeout(softFallback)
        softNavigationFallbackRef.current.delete(tabId)
        const timeout = navigationTimeoutRef.current.get(tabId)
        if (timeout) window.clearTimeout(timeout)
        navigationTimeoutRef.current.delete(tabId)
        navigationFallbackRef.current.delete(tabId)
        if (navigationErrorRef.current.has(tabId)) return
        setNavigationStateByTab((current) => {
            if (!(tabId in current)) return current
            const next = { ...current }
            delete next[tabId]
            return next
        })
    }, [])

    const beginTabNavigation = useCallback((tabId: string, url: string) => {
        navigationErrorRef.current.delete(tabId)
        const currentTab = tabsRef.current.find((tab) => tab.id === tabId)
        if (currentTab && !navigationFallbackRef.current.has(tabId)) {
            navigationFallbackRef.current.set(tabId, { ...currentTab, history: [...currentTab.history] })
        }
        const existingTimeout = navigationTimeoutRef.current.get(tabId)
        if (existingTimeout) window.clearTimeout(existingTimeout)
        setNavigationStateByTab((current) => ({ ...current, [tabId]: { status: "loading", requestedUrl: url } }))
        const timeout = window.setTimeout(() => {
            if (pendingNavigationRef.current.get(tabId) !== url) return
            pendingNavigationRef.current.delete(tabId)
            readyTabIdsRef.current.delete(tabId)
            const fallback = navigationFallbackRef.current.get(tabId)
            navigationFallbackRef.current.delete(tabId)
            if (fallback) {
                setTabs((existingTabs) => {
                    const restored = existingTabs.map((tab) => tab.id === tabId ? fallback : tab)
                    tabsRef.current = restored
                    saveTabsState(restored, activeTabIdRef.current)
                    return restored
                })
                const frame = iframeRefs.current.get(tabId)
                if (frame?.contentWindow) {
                    try {
                        frame.contentWindow.location.replace(workspaceTabFrameUrl(fallback.url, tabId, window.location.origin))
                    } catch {
                        frame.src = workspaceTabFrameUrl(fallback.url, tabId, window.location.origin)
                    }
                }
            }
            navigationTimeoutRef.current.delete(tabId)
            navigationErrorRef.current.add(tabId)
            setNavigationStateByTab((current) => ({
                ...current,
                [tabId]: { status: "error", requestedUrl: url, error: "This page took too long to load." },
            }))
        }, 12_000)
        navigationTimeoutRef.current.set(tabId, timeout)
    }, [saveTabsState])

    useEffect(() => () => {
        for (const timeout of navigationTimeoutRef.current.values()) window.clearTimeout(timeout)
        navigationTimeoutRef.current.clear()
        for (const timeout of softNavigationFallbackRef.current.values()) window.clearTimeout(timeout)
        softNavigationFallbackRef.current.clear()
    }, [])

    const readTabsState = useCallback((currentUrl: string): WorkspaceTabsState => {
        try {
            const stored = sessionStorage.getItem(tabsStorageKey)
            const parsed = stored ? JSON.parse(stored) as Partial<WorkspaceTabsState> : {}
            const storedTabs = Array.isArray(parsed.tabs)
                ? parsed.tabs.filter((tab) => Boolean(
                    tab && typeof tab.id === "string" && typeof tab.url === "string" && typeof tab.title === "string"
                )).map((tab) => {
                    const candidate = tab as Partial<WorkspaceTab> & Pick<WorkspaceTab, "id" | "title" | "url">
                    const url = normalizeWorkspaceUrl(candidate.url)
                    const history = Array.isArray(candidate.history) && candidate.history.every((entry) => typeof entry === "string") && candidate.history.length
                        ? candidate.history.map(normalizeWorkspaceUrl)
                        : [url]
                    const historyIndex = Number.isInteger(candidate.historyIndex)
                        ? Math.min(Math.max(candidate.historyIndex!, 0), history.length - 1)
                        : history.length - 1
                    return {
                        id: candidate.id,
                        title: titleForUrl(url),
                        customTitle: typeof candidate.customTitle === "string" ? normalizeWorkspaceTabCustomTitle(candidate.customTitle) ?? undefined : undefined,
                        recordTitle: typeof candidate.recordTitle?.url === "string" && typeof candidate.recordTitle?.title === "string"
                            ? { url: normalizeWorkspaceUrl(candidate.recordTitle.url), title: candidate.recordTitle.title.slice(0, 200) } : undefined,
                        url,
                        history,
                        historyIndex,
                        seenRevision: typeof candidate.seenRevision === "number" && Number.isFinite(candidate.seenRevision) ? candidate.seenRevision : 0,
                        detailPreview: parseWorkspaceDetailPreview(candidate.detailPreview) ?? undefined,
                    }
                }).filter((tab) => canOpenWorkspaceUrl(tab.url)).map((tab) => {
                    const allowedHistory = tab.history.filter(canOpenWorkspaceUrl)
                    const history = allowedHistory.length ? allowedHistory : [tab.url]
                    const historyIndex = Math.min(tab.historyIndex, history.length - 1)
                    return { ...tab, history, historyIndex }
                })
                : []
            const freshTab = { id: createTabId(), url: currentUrl, title: titleForUrl(currentUrl), history: [currentUrl], historyIndex: 0, seenRevision: 0 }
            const tabsToUse = storedTabs.length ? storedTabs : [freshTab]
            const activeId = typeof parsed.activeId === "string" && tabsToUse.some((tab) => tab.id === parsed.activeId)
                ? parsed.activeId
                : tabsToUse[0].id
            const migratedTabs = parsed.mode === "live"
                ? tabsToUse
                : tabsToUse.map((tab) => tab.id === activeId ? { ...tab, url: currentUrl, title: titleForUrl(currentUrl), history: [currentUrl], historyIndex: 0 } : tab)
            return {
                activeId,
                mode: "live",
                tabs: migratedTabs,
            }
        } catch {
            const tab = { id: createTabId(), url: currentUrl, title: titleForUrl(currentUrl), history: [currentUrl], historyIndex: 0, seenRevision: 0 }
            return { activeId: tab.id, mode: "live", tabs: [tab] }
        }
    }, [canOpenWorkspaceUrl, normalizeWorkspaceUrl, tabsStorageKey, titleForUrl])

    useEffect(() => {
        markWorkspaceLaunch("shell_hydrated_ms")
    }, [])

    useEffect(() => {
        activeTabIdRef.current = activeTabId
    }, [activeTabId])

    useEffect(() => {
        tabsRef.current = tabs
    }, [tabs])

    useEffect(() => {
        const activeTab = tabs.find((tab) => tab.id === activeTabId)
        if (activeTab) document.title = `${workspaceTabDisplayTitle(activeTab)} | Betelgeze`
    }, [activeTabId, tabs])

    useEffect(() => {
        if (!editingTabId) return
        tabTitleInputRef.current?.focus()
        tabTitleInputRef.current?.select()
    }, [editingTabId])

    const postToTab = useCallback((tabId: string, message: Omit<WorkspaceTabParentMessage, "source" | "target" | "tabId">) => {
        const frame = iframeRefs.current.get(tabId)
        if (!frame?.contentWindow) return false
        const payload: WorkspaceTabParentMessage = {
            source: WORKSPACE_TAB_MESSAGE_SOURCE,
            target: "frame",
            tabId,
            ...message,
        }
        frame.contentWindow.postMessage(payload, window.location.origin)
        return true
    }, [])

    const assignTabFrameRef = useCallback((tabId: string, node: HTMLIFrameElement | null) => {
        if (node) {
            iframeRefs.current.set(tabId, node)
            if (tabId === initialTab.id) markWorkspaceLaunch("initial_frame_mounted_ms")
            return
        }
        iframeRefs.current.delete(tabId)
        loadedTabIdsRef.current.delete(tabId)
        readyTabIdsRef.current.delete(tabId)
        setLoadedTabIds((current) => {
            if (!current.has(tabId)) return current
            const next = new Set(current)
            next.delete(tabId)
            return next
        })
        setRefreshingTabIds((current) => {
            if (!current.has(tabId)) return current
            const next = new Set(current)
            next.delete(tabId)
            return next
        })
    }, [initialTab.id])

    const markTabFrameReady = useCallback((tabId: string) => {
        loadedTabIdsRef.current.add(tabId)
        setLoadedTabIds((current) => {
            if (current.has(tabId)) return current
            const next = new Set(current)
            next.add(tabId)
            return next
        })
    }, [])

    const reportInitialPanelReady = useCallback((tabId: string) => {
        if (tabId !== initialTab.id || launchUsableReportedRef.current) return
        launchUsableReportedRef.current = true
        markWorkspaceLaunch("panel_ready_ms")
        setInitialPanelReady(true)
        reportWorkspaceLaunch({
            stage: "usable",
            workspaceSlug: workspace.slug,
            initialUrl: initialTab.url,
            serverTiming: launchServerTiming,
        })
    }, [initialTab.id, initialTab.url, launchServerTiming, workspace.slug])

    const ensureTabFrameLocation = useCallback((tabId: string, url: string, mode: "assign" | "replace" = "assign") => {
        const frame = iframeRefs.current.get(tabId)
        if (!frame?.contentWindow) return false
        const target = workspaceTabFrameUrl(url, tabId, window.location.origin)

        try {
            if (workspaceTabFrameMatchesUrl(frame.contentWindow.location.href, url, tabId, window.location.origin)) return false
            if (mode === "replace") frame.contentWindow.location.replace(target)
            else frame.contentWindow.location.assign(target)
        } catch {
            // The workspace frame is same-origin in normal operation. Keep a
            // src fallback so an unexpected intermediate document cannot
            // leave shell state and visible tab content permanently split.
            frame.src = target
        }
        return true
    }, [])

    const scheduleSoftNavigationFallback = useCallback((tabId: string, url: string, mode: "assign" | "replace" = "assign") => {
        const existing = softNavigationFallbackRef.current.get(tabId)
        if (existing) window.clearTimeout(existing)
        const timeout = window.setTimeout(() => {
            softNavigationFallbackRef.current.delete(tabId)
            if (pendingNavigationRef.current.get(tabId) === url) ensureTabFrameLocation(tabId, url, mode)
        }, WORKSPACE_SOFT_NAVIGATION_FALLBACK_MS)
        softNavigationFallbackRef.current.set(tabId, timeout)
    }, [ensureTabFrameLocation])

    const requestTabFrameNavigation = useCallback((tabId: string, url: string, mode: "assign" | "replace" = "assign") => {
        const messageType = mode === "replace" ? "traverse" : "navigate"
        if (readyTabIdsRef.current.has(tabId) && postToTab(tabId, { type: messageType, url })) {
            readyTabIdsRef.current.delete(tabId)
            // Let the frame keep its current UI while the App Router streams
            // the next route. A delayed direct navigation remains as a safety
            // net for a transition that never acknowledges its destination.
            scheduleSoftNavigationFallback(tabId, url, mode)
            return
        }

        // A loading frame may not have a live message listener. The host owns
        // the desired route, so cancel the stale document load directly.
        ensureTabFrameLocation(tabId, url, mode)
    }, [ensureTabFrameLocation, postToTab, scheduleSoftNavigationFallback])

    useEffect(() => {
        if (tabsBootstrappedRef.current) return
        tabsBootstrappedRef.current = true
        const query = searchParams.toString()
        const current = normalizeWorkspaceUrl(initialWorkspaceUrl ?? `${pathname}${query ? `?${query}` : ""}`)
        const stored = readTabsState(current)
        const storedActive = stored.tabs.find((tab) => tab.id === stored.activeId) ?? stored.tabs[0]
        const matchingInitial = stored.tabs.find((tab) => tab.id === initialTab.id)
            ?? stored.tabs.find((tab) => tab.url === initialTab.url)
        const replacedTabId = matchingInitial?.id ?? storedActive?.id
        const adoptedActive = matchingInitial
            ? { ...matchingInitial, id: initialTab.id, url: initialTab.url, title: titleForUrl(initialTab.url) }
            : initialTab
        const adoptedTabs = stored.tabs.length
            ? stored.tabs
                .map((tab) => tab.id === replacedTabId ? adoptedActive : tab)
                .filter((tab, index, values) => values.findIndex((candidate) => candidate.id === tab.id) === index)
            : [initialTab]
        const tabsToUse = adoptedTabs.length ? adoptedTabs : [initialTab]
        activeTabIdRef.current = initialTab.id
        tabsRef.current = tabsToUse
        tabFrameOrderRef.current = tabsToUse.map((tab) => tab.id)
        mutationRevisionRef.current = Math.max(0, ...tabsToUse.map((tab) => tab.seenRevision))
        saveTabsState(tabsToUse, initialTab.id)
        deferNavigationStateUpdate(() => {
            activateWorkspaceTab(initialTab.id)
            setTabs(tabsToUse)
            setTabFrameOrder(tabsToUse.map((tab) => tab.id))
            setTabsHydrated(true)
        })
    }, [activateWorkspaceTab, initialTab, initialWorkspaceUrl, normalizeWorkspaceUrl, pathname, readTabsState, saveTabsState, searchParams, titleForUrl])

    const setTabContextOpen = useCallback((tabId: string, open: boolean) => {
        sessionStorage.setItem(workspaceTabContextStorageKey(workspace.slug, tabId), open ? "true" : "false")
        setContextOpenByTab((current) => current[tabId] === open ? current : { ...current, [tabId]: open })
        postToTab(tabId, { type: "context-set", open })
    }, [postToTab, workspace.slug])

    const setTabContextStatus = useCallback((tabId: string, status: WorkspaceTabContextStatus) => {
        contextStatusByTabRef.current = { ...contextStatusByTabRef.current, [tabId]: status }
        setContextStatusByTab((current) => {
            const existing = current[tabId]
            if (existing?.supported === status.supported && existing.relationshipId === status.relationshipId && existing.context === status.context) return current
            return { ...current, [tabId]: status }
        })
    }, [])

    const reopenClosedTab = useCallback(() => {
        if (!canAddTabRef.current) return false
        const closed = closedTabsRef.current.pop()
        if (!closed) return false

        const previousTabId = activeTabIdRef.current
        const restoredTab = { ...closed.tab, seenRevision: mutationRevisionRef.current }
        if (!tabFrameOrderRef.current.includes(restoredTab.id)) {
            tabFrameOrderRef.current.push(restoredTab.id)
            setTabFrameOrder([...tabFrameOrderRef.current])
        }
        loadedTabIdsRef.current.delete(closed.tab.id)
        readyTabIdsRef.current.delete(closed.tab.id)
        pendingNavigationRef.current.delete(closed.tab.id)
        setLoadedTabIds(new Set(loadedTabIdsRef.current))
        setTabs((existingTabs) => {
            const insertionIndex = Math.min(Math.max(closed.index, 0), existingTabs.length)
            const nextTabs = [
                ...existingTabs.slice(0, insertionIndex),
                restoredTab,
                ...existingTabs.slice(insertionIndex),
            ]
            activeTabIdRef.current = restoredTab.id
            activateWorkspaceTab(restoredTab.id)
            saveTabsState(nextTabs, restoredTab.id)
            return nextTabs
        })
        window.requestAnimationFrame(() => postToTab(previousTabId, { type: "activate", active: false, refresh: false }))
        return true
    }, [activateWorkspaceTab, postToTab, saveTabsState])

    const openWorkspaceTab = useCallback((href: string, detailPreview?: WorkspaceDetailPreview) => {
        const url = normalizeWorkspaceUrl(href)
        if (detailPreview) storeWorkspaceDetailPreview(url, detailPreview)
        const currentTabs = tabsRef.current
        const existingTab = currentTabs.find((tab) => tab.url === url)
        const previousTabId = activeTabIdRef.current

        if (existingTab) {
            if (existingTab.id === previousTabId) return
            const refresh = existingTab.seenRevision < mutationRevisionRef.current
            const nextTabs = currentTabs.map((tab) => tab.id === existingTab.id
                ? { ...tab, seenRevision: refresh ? mutationRevisionRef.current : tab.seenRevision, detailPreview: detailPreview ?? tab.detailPreview }
                : tab)
            tabsRef.current = nextTabs
            activeTabIdRef.current = existingTab.id
            setTabs(nextTabs)
            activateWorkspaceTab(existingTab.id)
            saveTabsState(nextTabs, existingTab.id)
            window.requestAnimationFrame(() => {
                postToTab(previousTabId, { type: "activate", active: false, refresh: false })
                postToTab(existingTab.id, { type: "activate", active: true, refresh })
                const desiredUrl = pendingNavigationRef.current.get(existingTab.id) ?? existingTab.url
                if (ensureTabFrameLocation(existingTab.id, desiredUrl)) beginTabNavigation(existingTab.id, desiredUrl)
            })
            return
        }

        if (currentTabs.length >= 8) {
            const tabId = activeTabIdRef.current
            if (!tabId) return
            beginTabNavigation(tabId, url)
            updateTabForShellNavigation(tabId, url, detailPreview)
            pendingNavigationRef.current.set(tabId, url)
            requestTabFrameNavigation(tabId, url)
            return
        }

        const tab: WorkspaceTab = {
            id: createTabId(),
            title: titleForUrl(url),
            url,
            history: [url],
            historyIndex: 0,
            seenRevision: mutationRevisionRef.current,
            detailPreview,
        }
        const nextTabs = [...currentTabs, tab]
        tabFrameOrderRef.current.push(tab.id)
        setTabFrameOrder([...tabFrameOrderRef.current])
        tabsRef.current = nextTabs
        activeTabIdRef.current = tab.id
        setTabs(nextTabs)
        activateWorkspaceTab(tab.id)
        sessionStorage.setItem(workspaceTabContextStorageKey(workspace.slug, tab.id), "true")
        setContextOpenByTab((current) => ({ ...current, [tab.id]: true }))
        saveTabsState(nextTabs, tab.id)
        window.requestAnimationFrame(() => postToTab(previousTabId, { type: "activate", active: false, refresh: false }))
    }, [activateWorkspaceTab, beginTabNavigation, ensureTabFrameLocation, normalizeWorkspaceUrl, postToTab, requestTabFrameNavigation, saveTabsState, titleForUrl, updateTabForShellNavigation, workspace.slug])

    useEffect(() => {
        function openPortalledDetail(event: MouseEvent) {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
            const target = event.target
            if (!(target instanceof Element)) return
            const anchor = target.closest("a[data-workspace-detail-preview]") as HTMLAnchorElement | null
            if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return
            const destination = new URL(anchor.href, window.location.href)
            if (destination.origin !== window.location.origin) return
            const nextUrl = `${destination.pathname}${destination.search}${destination.hash}`
            if (!workspaceRouteIsRecordDetail(nextUrl, workspace.slug, window.location.origin)) return
            const detailPreview = parseWorkspaceDetailPreview(anchor.getAttribute("data-workspace-detail-preview"))
            event.preventDefault()
            openWorkspaceTab(nextUrl, detailPreview ?? undefined)
        }

        document.addEventListener("click", openPortalledDetail, true)
        return () => document.removeEventListener("click", openPortalledDetail, true)
    }, [openWorkspaceTab, workspace.slug])

    useEffect(() => {
        function receiveFrameMessage(event: MessageEvent<WorkspaceTabFrameMessage>) {
            if (event.origin !== window.location.origin) return
            const message = event.data
            if (message?.source !== WORKSPACE_TAB_MESSAGE_SOURCE || message.target !== "host") return
            const frame = iframeRefs.current.get(message.tabId)
            if (!frame || event.source !== frame.contentWindow) return

            if (message.type === "record-title" && message.url && typeof message.title === "string") {
                const recordTitle = { url: normalizeWorkspaceUrl(message.url), title: message.title.slice(0, 200) }
                setTabs((existingTabs) => {
                    const updatedTabs = existingTabs.map((tab) => tab.id === message.tabId ? { ...tab, recordTitle } : tab)
                    tabsRef.current = updatedTabs
                    saveTabsState(updatedTabs, activeTabIdRef.current)
                    return updatedTabs
                })
                return
            }

            if (message.type === "location-replace" && message.url) {
                const url = normalizeWorkspaceUrl(message.url)
                markTabFrameReady(message.tabId)
                reportInitialPanelReady(message.tabId)
                readyTabIdsRef.current.add(message.tabId)
                // The frame only reports its location after its bridge effects
                // have mounted. Reply here as the reliable activation
                // handshake instead of relying solely on the iframe load
                // event, which can fire before the frame installs its message
                // listener.
                postToTab(message.tabId, { type: "activate", active: message.tabId === activeTabIdRef.current, refresh: false })
                pendingNavigationRef.current.delete(message.tabId)
                completeTabNavigation(message.tabId)
                if (message.tabId === activeTabIdRef.current) setRouteLoadingTabId(null)
                setTabs((existingTabs) => {
                    const updatedTabs = existingTabs.map((tab) => {
                        if (tab.id !== message.tabId) return tab
                        const history = [...tab.history]
                        history[tab.historyIndex] = url
                        return { ...tab, url, title: titleForUrl(url), history }
                    })
                    tabsRef.current = updatedTabs
                    saveTabsState(updatedTabs, activeTabIdRef.current)
                    return updatedTabs
                })
                return
            }

            if (message.type === "location" && message.url) {
                const url = normalizeWorkspaceUrl(message.url)
                const pendingUrl = pendingNavigationRef.current.get(message.tabId)
                markTabFrameReady(message.tabId)
                readyTabIdsRef.current.add(message.tabId)
                postToTab(message.tabId, { type: "activate", active: message.tabId === activeTabIdRef.current, refresh: false })
                if (pendingUrl && pendingUrl !== url) {
                    // This is the initial location handshake for a frame that
                    // was still booting when navigation was requested. The
                    // bridge is listening now, so safely replay the request.
                    window.requestAnimationFrame(() => {
                        if (pendingNavigationRef.current.get(message.tabId) === pendingUrl) {
                            requestTabFrameNavigation(message.tabId, pendingUrl)
                        }
                    })
                    return
                }
                if (pendingUrl === url) pendingNavigationRef.current.delete(message.tabId)
                reportInitialPanelReady(message.tabId)
                completeTabNavigation(message.tabId)
                if (message.tabId === activeTabIdRef.current) setRouteLoadingTabId(null)
                setTabs((existingTabs) => {
                    const updatedTabs = existingTabs.map((tab) => {
                        if (tab.id !== message.tabId) return tab
                        if (tab.history[tab.historyIndex] === url) return { ...tab, url, title: titleForUrl(url) }
                        if (tab.history[tab.historyIndex - 1] === url) return { ...tab, url, title: titleForUrl(url), historyIndex: tab.historyIndex - 1 }
                        if (tab.history[tab.historyIndex + 1] === url) return { ...tab, url, title: titleForUrl(url), historyIndex: tab.historyIndex + 1 }
                        const nextHistory = appendWorkspaceTabHistory(tab.history, tab.historyIndex, url)
                        return { ...tab, url, title: titleForUrl(url), ...nextHistory }
                    })
                    saveTabsState(updatedTabs, activeTabIdRef.current)
                    return updatedTabs
                })
                if (!routeCanShowRelationshipContext(url)) {
                    setTabContextStatus(message.tabId, { supported: false, relationshipId: null, context: null })
                    setTabContextOpen(message.tabId, false)
                }
            }

            if (message.type === "mutation") {
                const revision = mutationRevisionRef.current + 1
                mutationRevisionRef.current = revision
                setTabs((existingTabs) => {
                    const updatedTabs = existingTabs.map((tab) => tab.id === message.tabId ? { ...tab, seenRevision: revision } : tab)
                    saveTabsState(updatedTabs, activeTabIdRef.current)
                    return updatedTabs
                })
            }

            if (message.type === "action-start") {
                if (message.tabId === activeTabIdRef.current) setRouteLoadingTabId(message.tabId)
            }

            if (message.type === "action-end") {
                if (message.tabId === activeTabIdRef.current) setRouteLoadingTabId(null)
            }

            if (message.type === "refresh-start") {
                setRefreshingTabIds((current) => {
                    if (current.has(message.tabId)) return current
                    const next = new Set(current)
                    next.add(message.tabId)
                    return next
                })
            }

            if (message.type === "refresh-end") {
                setRefreshingTabIds((current) => {
                    if (!current.has(message.tabId)) return current
                    const next = new Set(current)
                    next.delete(message.tabId)
                    return next
                })
            }

            if (message.type === "mutation-start") {
                const id = message.mutationId || `mutation-${Date.now()}`
                const active = mutationIdsByTabRef.current.get(message.tabId) ?? new Set<string>()
                active.add(id)
                mutationIdsByTabRef.current.set(message.tabId, active)
                setBackgroundMutationCounts((current) => ({ ...current, [message.tabId]: active.size }))
                if (message.tabId === activeTabIdRef.current) {
                    setBackgroundMutationState("saving")
                    setBackgroundMutationError(null)
                }
            }

            if (message.type === "mutation-end") {
                const active = mutationIdsByTabRef.current.get(message.tabId) ?? new Set<string>()
                if (message.mutationId) active.delete(message.mutationId)
                else active.clear()
                mutationIdsByTabRef.current.set(message.tabId, active)
                setBackgroundMutationCounts((current) => ({ ...current, [message.tabId]: active.size }))
                if (message.tabId === activeTabIdRef.current) {
                    setBackgroundMutationState(message.mutationFailed ? "error" : active.size ? "saving" : "saved")
                    setBackgroundMutationError(message.mutationFailed ? message.mutationError || "A workspace change could not be saved." : null)
                }
            }

            if (message.type === "poll-started" && message.pollId) {
                showCreationNotice({ label: "Poll started", href: `/${workspace.slug}/leadgen/poll/${message.pollId}` })
            }

            if (message.type === "communications-unread" && Number.isFinite(message.unreadCount)) {
                setCommunicationsUnreadCount(Math.max(0, Math.floor(message.unreadCount ?? 0)))
            }

            if (message.type === "navigation-start") {
                if (message.url) {
                    const url = normalizeWorkspaceUrl(message.url)
                    beginTabNavigation(message.tabId, url)
                    pendingNavigationRef.current.set(message.tabId, url)
                    updateTabForShellNavigation(message.tabId, url)
                    scheduleSoftNavigationFallback(message.tabId, url)
                }
                readyTabIdsRef.current.delete(message.tabId)
            }

            if (message.type === "open-tab" && message.url) {
                openWorkspaceTab(message.url, message.detailPreview)
            }

            if (message.type === "reopen-closed-tab") {
                reopenClosedTab()
            }

            if (message.type === "context-status") {
                const relationshipId = message.relationshipId ?? null
                const supported = message.contextSupported === true && Boolean(relationshipId)

                if (!supported) {
                    const currentStatus = contextStatusByTabRef.current[message.tabId]
                    if (currentStatus?.supported && relationshipId && currentStatus.relationshipId !== relationshipId) return
                    setTabContextStatus(message.tabId, { supported: false, relationshipId: null, context: null })
                    setTabContextOpen(message.tabId, false)
                    return
                }

                setTabContextStatus(message.tabId, { supported: true, relationshipId, context: message.context ?? null })
                if (!contextManualClosedByTabRef.current[message.tabId]) {
                    delete contextManualClosedByTabRef.current[message.tabId]
                    setTabContextOpen(message.tabId, true)
                }
            }

            if (message.type === "context-obstruction") {
                const obstructed = message.contextObstructed === true
                contextObstructedByTabRef.current = { ...contextObstructedByTabRef.current, [message.tabId]: obstructed }
                setContextObstructedByTab((current) => current[message.tabId] === obstructed ? current : { ...current, [message.tabId]: obstructed })
            }
        }

        window.addEventListener("message", receiveFrameMessage)
        return () => window.removeEventListener("message", receiveFrameMessage)
    }, [beginTabNavigation, completeTabNavigation, markTabFrameReady, normalizeWorkspaceUrl, openWorkspaceTab, postToTab, reopenClosedTab, reportInitialPanelReady, requestTabFrameNavigation, routeCanShowRelationshipContext, saveTabsState, scheduleSoftNavigationFallback, setTabContextOpen, setTabContextStatus, showCreationNotice, titleForUrl, updateTabForShellNavigation, workspace.slug])

    useEffect(() => {
        if (!tabsHydrated || readyTabIdsRef.current.has(initialTab.id)) return
        const delays = [0, 120, 360, 900]
        const timeouts = delays.map((delay) => window.setTimeout(() => {
            if (!readyTabIdsRef.current.has(initialTab.id)) postToTab(initialTab.id, { type: "probe" })
        }, delay))
        return () => timeouts.forEach((timeout) => window.clearTimeout(timeout))
    }, [initialTab.id, postToTab, tabsHydrated])

    useEffect(() => {
        function start(event: Event) {
            const detail = (event as CustomEvent<WorkspaceMutationEventDetail>).detail
            const tabId = activeTabIdRef.current
            if (!tabId || !detail?.mutationId) return
            const active = mutationIdsByTabRef.current.get(tabId) ?? new Set<string>()
            active.add(detail.mutationId)
            mutationIdsByTabRef.current.set(tabId, active)
            setBackgroundMutationCounts((current) => ({ ...current, [tabId]: active.size }))
            setBackgroundMutationState("saving")
            setBackgroundMutationError(null)
        }
        function end(event: Event) {
            const detail = (event as CustomEvent<WorkspaceMutationEventDetail>).detail
            const tabId = activeTabIdRef.current
            if (!tabId || !detail?.mutationId) return
            const active = mutationIdsByTabRef.current.get(tabId) ?? new Set<string>()
            active.delete(detail.mutationId)
            mutationIdsByTabRef.current.set(tabId, active)
            setBackgroundMutationCounts((current) => ({ ...current, [tabId]: active.size }))
            setBackgroundMutationState(detail.failed ? "error" : active.size ? "saving" : "saved")
            setBackgroundMutationError(detail.failed ? detail.error || "A workspace change could not be saved." : null)
        }
        window.addEventListener(WORKSPACE_MUTATION_START, start)
        window.addEventListener(WORKSPACE_MUTATION_END, end)
        return () => {
            window.removeEventListener(WORKSPACE_MUTATION_START, start)
            window.removeEventListener(WORKSPACE_MUTATION_END, end)
        }
    }, [])

    useEffect(() => {
        if (backgroundMutationState !== "saved") return
        const timeout = window.setTimeout(() => setBackgroundMutationState("idle"), 2200)
        return () => window.clearTimeout(timeout)
    }, [backgroundMutationState])

    useEffect(() => {
        if (!tabsHydrated) return
        const shellRoot = shellRootRef.current
        const host = shellRoot?.parentElement
        if (!shellRoot || !host) return
        const hiddenSiblings = Array.from(host.children).filter((element): element is HTMLElement => element instanceof HTMLElement && element !== shellRoot)
        const previousOverflow = document.body.style.overflow
        const root = document.documentElement
        const readViewportBottom = () => {
            const visualViewport = window.visualViewport
            return Math.round((visualViewport?.offsetTop ?? 0) + (visualViewport?.height ?? window.innerHeight))
        }
        let restingViewportBottom = readViewportBottom()
        let keyboardViewportBottom: number | null = null
        let composerFocused = false
        let viewportMode: "idle" | "pending" | "continuous" | "synthetic" | "closing" | "suspended" = "idle"
        let syntheticTargetCommitted = false
        let animationFrame = 0
        let closeTimer = 0
        const writeViewportBottom = (viewportBottom: number) => {
            root.style.setProperty("--workspace-visual-viewport-bottom", `${viewportBottom}px`)
        }
        const keepWorkspaceDocumentAtOrigin = () => {
            if (root.scrollTop !== 0) root.scrollTop = 0
            if (document.body.scrollTop !== 0) document.body.scrollTop = 0
        }
        const scheduleSyntheticViewport = () => {
            if (animationFrame || syntheticTargetCommitted) return
            animationFrame = window.requestAnimationFrame(() => {
                animationFrame = 0
                if (viewportMode !== "synthetic" || keyboardViewportBottom === null || syntheticTargetCommitted) return
                syntheticTargetCommitted = true
                writeViewportBottom(keyboardViewportBottom)
            })
        }
        const holdWorkspaceViewport = () => {
            if (document.visibilityState === "hidden") return
            keepWorkspaceDocumentAtOrigin()
            const viewportBottom = readViewportBottom()
            if (viewportMode === "closing" || viewportMode === "suspended") return
            if (!composerFocused) {
                restingViewportBottom = viewportBottom
                keyboardViewportBottom = null
                syntheticTargetCommitted = false
                viewportMode = "idle"
                delete root.dataset.workspaceKeyboardMotion
                writeViewportBottom(viewportBottom)
                return
            }

            const keyboardShift = restingViewportBottom - viewportBottom
            if (keyboardShift <= 1) return
            if (viewportMode === "pending") {
                // Preserve progressive viewport updates, but smooth browsers that expose
                // the keyboard movement as one large jump before the keyboard catches up.
                viewportMode = keyboardShift >= WORKSPACE_KEYBOARD_MINIMUM_SHIFT_PX ? "synthetic" : "continuous"
                if (viewportMode === "synthetic") root.dataset.workspaceKeyboardMotion = "true"
            }
            if (viewportMode === "synthetic") {
                keyboardViewportBottom = Math.min(keyboardViewportBottom ?? viewportBottom, viewportBottom)
                scheduleSyntheticViewport()
            } else {
                writeViewportBottom(viewportBottom)
            }
        }
        const handleComposerFocus = (event: Event) => {
            const focused = (event as CustomEvent<WorkspaceComposerFocusEventDetail>).detail?.focused
            if (typeof focused !== "boolean") return
            if (document.visibilityState === "hidden") {
                if (!focused) composerFocused = false
                return
            }
            if (focused) {
                if (closeTimer) window.clearTimeout(closeTimer)
                closeTimer = 0
                keepWorkspaceDocumentAtOrigin()
                composerFocused = true
                if (viewportMode === "closing" && keyboardViewportBottom !== null) {
                    viewportMode = "synthetic"
                    syntheticTargetCommitted = true
                    root.dataset.workspaceKeyboardMotion = "true"
                    writeViewportBottom(keyboardViewportBottom)
                    return
                }
                restingViewportBottom = readViewportBottom()
                keyboardViewportBottom = null
                syntheticTargetCommitted = false
                viewportMode = "pending"
                delete root.dataset.workspaceKeyboardMotion
                writeViewportBottom(restingViewportBottom)
                return
            }

            composerFocused = false
            if (viewportMode !== "synthetic" || keyboardViewportBottom === null) {
                viewportMode = "idle"
                delete root.dataset.workspaceKeyboardMotion
                holdWorkspaceViewport()
                return
            }
            if (animationFrame) window.cancelAnimationFrame(animationFrame)
            animationFrame = 0
            viewportMode = "closing"
            root.dataset.workspaceKeyboardMotion = "true"
            // Start the return from the same captured resting edge rather than waiting
            // for a late or incomplete visualViewport event from iOS.
            writeViewportBottom(restingViewportBottom)
            closeTimer = window.setTimeout(() => {
                closeTimer = 0
                viewportMode = "idle"
                keyboardViewportBottom = null
                syntheticTargetCommitted = false
                delete root.dataset.workspaceKeyboardMotion
                holdWorkspaceViewport()
            }, WORKSPACE_KEYBOARD_SETTLE_MS)
        }
        const suspendWorkspaceViewport = () => {
            const activeElement = document.activeElement
            if (activeElement instanceof HTMLElement) activeElement.blur()
            composerFocused = false
            if (animationFrame) window.cancelAnimationFrame(animationFrame)
            animationFrame = 0
            if (closeTimer) window.clearTimeout(closeTimer)
            closeTimer = 0
            viewportMode = "suspended"
            keyboardViewportBottom = null
            syntheticTargetCommitted = false
            delete root.dataset.workspaceKeyboardMotion
            keepWorkspaceDocumentAtOrigin()
            writeViewportBottom(restingViewportBottom)
        }
        const resumeWorkspaceViewport = () => {
            if (document.visibilityState !== "visible" || viewportMode !== "suspended") return
            keepWorkspaceDocumentAtOrigin()
            writeViewportBottom(restingViewportBottom)
            closeTimer = window.setTimeout(() => {
                closeTimer = 0
                viewportMode = "idle"
                holdWorkspaceViewport()
            }, WORKSPACE_KEYBOARD_SETTLE_MS)
        }
        const handleWorkspaceVisibility = () => {
            if (document.visibilityState === "hidden") suspendWorkspaceViewport()
            else resumeWorkspaceViewport()
        }
        const previousStates = hiddenSiblings.map((element) => ({ element, hidden: element.hidden, inert: element.inert, ariaHidden: element.getAttribute("aria-hidden") }))
        document.body.style.overflow = "hidden"
        document.body.dataset.workspaceTabsHosted = "true"
        root.dataset.workspaceViewportLocked = "true"
        window.addEventListener("resize", holdWorkspaceViewport)
        window.visualViewport?.addEventListener("resize", holdWorkspaceViewport)
        window.visualViewport?.addEventListener("scroll", holdWorkspaceViewport)
        window.addEventListener(WORKSPACE_COMPOSER_FOCUS_EVENT, handleComposerFocus)
        document.addEventListener("visibilitychange", handleWorkspaceVisibility)
        window.addEventListener("pagehide", suspendWorkspaceViewport)
        window.addEventListener("pageshow", resumeWorkspaceViewport)
        holdWorkspaceViewport()
        window.dispatchEvent(new Event(WORKSPACE_TAB_VISIBILITY_EVENT))
        hiddenSiblings.forEach((element) => {
            element.hidden = true
            element.inert = true
            element.setAttribute("aria-hidden", "true")
        })

        return () => {
            window.removeEventListener("resize", holdWorkspaceViewport)
            window.visualViewport?.removeEventListener("resize", holdWorkspaceViewport)
            window.visualViewport?.removeEventListener("scroll", holdWorkspaceViewport)
            window.removeEventListener(WORKSPACE_COMPOSER_FOCUS_EVENT, handleComposerFocus)
            document.removeEventListener("visibilitychange", handleWorkspaceVisibility)
            window.removeEventListener("pagehide", suspendWorkspaceViewport)
            window.removeEventListener("pageshow", resumeWorkspaceViewport)
            if (animationFrame) window.cancelAnimationFrame(animationFrame)
            if (closeTimer) window.clearTimeout(closeTimer)
            document.body.style.overflow = previousOverflow
            delete document.body.dataset.workspaceTabsHosted
            delete root.dataset.workspaceViewportLocked
            delete root.dataset.workspaceKeyboardMotion
            root.style.removeProperty("--workspace-visual-viewport-bottom")
            window.dispatchEvent(new Event(WORKSPACE_TAB_VISIBILITY_EVENT))
            previousStates.forEach(({ element, hidden, inert, ariaHidden }) => {
                element.hidden = hidden
                element.inert = inert
                if (ariaHidden === null) element.removeAttribute("aria-hidden")
                else element.setAttribute("aria-hidden", ariaHidden)
            })
        }
    }, [tabsHydrated])

    useEffect(() => {
        const close = (event: MouseEvent) => {
            const target = event.target as Node
            const inDesktopSearch = desktopSearchRef.current?.contains(target)
            const inMobileSearch = mobileSearchRef.current?.contains(target)
            if (!inDesktopSearch && !inMobileSearch) setSearchOpen(false)
        }
        const escape = (event: KeyboardEvent) => {
            if (event.key === "Escape") setSearchOpen(false)
        }
        const closeForOtherDropdown = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== searchMenuId) setSearchOpen(false)
        }
        document.addEventListener("mousedown", close)
        document.addEventListener("keydown", escape)
        window.addEventListener("betelgeze:dropdown-open", closeForOtherDropdown)
        return () => {
            document.removeEventListener("mousedown", close)
            document.removeEventListener("keydown", escape)
            window.removeEventListener("betelgeze:dropdown-open", closeForOtherDropdown)
        }
    }, [searchMenuId])

    useEffect(() => {
        const isMac = /Mac|iPhone|iPad|iPod/i.test(window.navigator.platform) || /Mac OS|iPhone|iPad|iPod/i.test(window.navigator.userAgent)
        deferNavigationStateUpdate(() => setSearchShortcutLabel(isMac ? "⌘J" : "Ctrl+J"))
        const openFromShortcut = (event: KeyboardEvent) => {
            if (event.key.toLowerCase() !== "j") return
            if (isMac ? !event.metaKey : !event.ctrlKey) return
            event.preventDefault()
            window.dispatchEvent(new CustomEvent("betelgeze:dropdown-open", { detail: searchMenuId }))
            setSearchOpen(true)
            window.requestAnimationFrame(() => {
                if (window.matchMedia("(min-width: 768px)").matches) desktopSearchInputRef.current?.focus()
                else mobileSearchInputRef.current?.focus()
            })
        }
        document.addEventListener("keydown", openFromShortcut)
        return () => document.removeEventListener("keydown", openFromShortcut)
    }, [searchMenuId])

    useEffect(() => {
        function handleReopenClosedTab(event: KeyboardEvent) {
            if (!isReopenClosedTabShortcut(event)) return
            if (reopenClosedTab()) event.preventDefault()
        }

        document.addEventListener("keydown", handleReopenClosedTab)
        return () => document.removeEventListener("keydown", handleReopenClosedTab)
    }, [reopenClosedTab])

    useEffect(() => {
        deferNavigationStateUpdate(() => {
            setSidebarOpen(sessionStorage.getItem(sidebarStorageKey) === "true")
            setSidebarHydrated(true)
        })
    }, [])

    useEffect(() => {
        return () => {
            if (sidebarTransitionTimeout.current) window.clearTimeout(sidebarTransitionTimeout.current)
            if (tabWarmTimeoutRef.current) window.clearTimeout(tabWarmTimeoutRef.current)
            dragCleanupRef.current?.()
        }
    }, [])

    useEffect(() => {
        document.body.dataset.workspaceSidebarOpen = sidebarOpen ? "true" : "false"
        document.body.dataset.workspaceSidebarTransition = sidebarTransitionEnabled ? "true" : "false"
        document.documentElement.style.setProperty("--workspace-sidebar-width", sidebarOpen ? "18rem" : "0px")
        if (sidebarHydrated) sessionStorage.setItem(sidebarStorageKey, sidebarOpen ? "true" : "false")

        return () => {
            document.body.dataset.workspaceSidebarOpen = "false"
            document.body.dataset.workspaceSidebarTransition = "false"
            document.documentElement.style.setProperty("--workspace-sidebar-width", "0px")
        }
    }, [sidebarOpen, sidebarHydrated, sidebarTransitionEnabled])

    useEffect(() => {
        if (searchOpen) mobileSearchInputRef.current?.focus()
    }, [searchOpen])

    useEffect(() => {
        const trimmed = query.trim()
        if (trimmed.length < 2) {
            deferNavigationStateUpdate(() => {
                setSearchResults([])
                setSearchLoading(false)
            })
            return
        }

        const controller = new AbortController()
        const timeout = window.setTimeout(async () => {
            setSearchLoading(true)
            try {
                const response = await fetch(`/api/workspaces/${workspace.slug}/search?q=${encodeURIComponent(trimmed)}`, {
                    signal: controller.signal,
                })
                if (!response.ok) throw new Error("Search failed")
                const payload = await response.json() as { results?: SearchResult[] }
                setSearchResults(payload.results ?? [])
            } catch (error) {
                if ((error as Error).name !== "AbortError") setSearchResults([])
            } finally {
                setSearchLoading(false)
            }
        }, 180)

        return () => {
            controller.abort()
            window.clearTimeout(timeout)
        }
    }, [query, workspace.slug])

    useEffect(() => {
        if (!tabsHydrated || !activeTabId) return
        const tab = tabs.find((candidate) => candidate.id === activeTabId)
        if (!tab) return
        const url = new URL(tab.url, window.location.origin)
        const intent = url.searchParams.get("create")
        if (intent !== "relationship" && intent !== "work-item" && intent !== "asset" && intent !== "okr") return
        if ((intent === "relationship" && !canAccessWorkspacePanel(WORKSPACE_PANELS[0], workspaceRole, workspaceCapabilities))
            || ((intent === "work-item" || intent === "asset") && !canAccessWorkspacePanel(WORKSPACE_PANELS[5], workspaceRole, workspaceCapabilities))
            || (intent === "okr" && !canAccessPrivateWorkspacePanels(workspaceRole))) return
        const key = `${tab.id}:${url.pathname}:${intent}`
        if (createIntentHandledRef.current === key) return
        createIntentHandledRef.current = key
        setCreateTarget(intent)
    }, [activeTabId, tabs, tabsHydrated, workspaceCapabilities, workspaceRole])

    useEffect(() => {
        if (!tabsHydrated) return
        const updateCanAddTab = () => {
            const strip = tabStripRef.current
            if (!strip) return
            if (window.matchMedia("(max-width: 767px)").matches) {
                const nextCanAddTab = tabs.length < 8
                canAddTabRef.current = nextCanAddTab
                setCanAddTab(nextCanAddTab)
                return
            }
            const gap = Number.parseFloat(window.getComputedStyle(strip).columnGap || "0") || 0
            const children = Array.from(strip.children).filter((child): child is HTMLElement => child instanceof HTMLElement)
            const currentContentWidth = children.reduce((sum, child) => sum + child.offsetWidth, 0) + Math.max(0, children.length - 1) * gap
            const minimumNewTabSpace = 128 + gap
            const nextCanAddTab = currentContentWidth + minimumNewTabSpace <= strip.clientWidth
            canAddTabRef.current = nextCanAddTab
            setCanAddTab(nextCanAddTab)
        }

        updateCanAddTab()
        window.addEventListener("resize", updateCanAddTab)
        const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateCanAddTab) : null
        if (tabStripRef.current) observer?.observe(tabStripRef.current)
        return () => {
            window.removeEventListener("resize", updateCanAddTab)
            observer?.disconnect()
        }
    }, [tabs, tabsHydrated])

    useEffect(() => {
        if (!routeLoadingTabId) return

        const timeout = window.setTimeout(() => {
            setRouteLoadingTabId(null)
        }, 8000)

        return () => window.clearTimeout(timeout)
    }, [routeLoadingTabId])

    useEffect(() => {
        if (!tabsHydrated) return
        deferNavigationStateUpdate(() => {
            setContextOpenByTab((current) => {
                let changed = false
                const next: Record<string, boolean> = {}
                for (const tab of tabs) {
                    const stored = sessionStorage.getItem(workspaceTabContextStorageKey(workspace.slug, tab.id))
                    next[tab.id] = stored === null ? current[tab.id] ?? true : stored !== "false"
                    if (next[tab.id] !== current[tab.id]) changed = true
                }
                return changed || Object.keys(current).length !== Object.keys(next).length ? next : current
            })
        })
    }, [tabs, tabsHydrated, workspace.slug])

    function traverseHistory(step: -1 | 1) {
        const tabId = activeTabIdRef.current
        const tab = tabs.find((candidate) => candidate.id === tabId)
        if (!tab) return
        const destination = workspaceTabHistoryStep(tab.history, tab.historyIndex, step)
        if (!destination) return

        beginTabNavigation(tabId, destination.url)
        const nextTabs = tabs.map((candidate) => candidate.id === tabId
            ? { ...candidate, url: destination.url, title: titleForUrl(destination.url), historyIndex: destination.historyIndex }
            : candidate)
        setTabs(nextTabs)
        saveTabsState(nextTabs, tabId)
        pendingNavigationRef.current.set(tabId, destination.url)
        requestTabFrameNavigation(tabId, destination.url, "replace")
    }

    function goBack() {
        traverseHistory(-1)
    }

    function goForward() {
        traverseHistory(1)
    }

    function reloadWorkspace() {
        const tabId = activeTabIdRef.current
        const tab = tabsRef.current.find((candidate) => candidate.id === tabId)
        if (!tab) return
        postToTab(tabId, { type: "activate", active: true, refresh: true })
    }

    function openDesktopSearch() {
        if (!searchOpen) window.dispatchEvent(new CustomEvent("betelgeze:dropdown-open", { detail: searchMenuId }))
        setSearchOpen(true)
    }

    function openMobileSearch() {
        closeSidebarAfterNavigation()
        if (!searchOpen) window.dispatchEvent(new CustomEvent("betelgeze:dropdown-open", { detail: searchMenuId }))
        setSearchOpen(true)
        window.requestAnimationFrame(() => mobileSearchInputRef.current?.focus())
    }

    function openCreate(target: "relationship" | "work-item" | "asset" | "okr") {
        if (target === "relationship" && !canAccessWorkspacePanel(WORKSPACE_PANELS[0], workspaceRole, workspaceCapabilities)) return
        if ((target === "work-item" || target === "asset") && !canAccessWorkspacePanel(WORKSPACE_PANELS[5], workspaceRole, workspaceCapabilities)) return
        if (target === "okr" && !canAccessPrivateWorkspacePanels(workspaceRole)) return
        window.dispatchEvent(new CustomEvent("betelgeze:dropdown-open", { detail: "workspace-create" }))
        setCreateTarget(target)
    }

    function directSearchHref(value: string) {
        const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ")
        const canAccessPrivatePanels = canAccessPrivateWorkspacePanels(workspaceRole)
        if (canAccessPrivatePanels && (normalized === "new poll" || normalized === "create poll" || normalized === "start poll" || normalized === "run poll")) return `/${workspace.slug}/leadgen/new`
        if (capabilitySet.has("communications.manage") && (normalized === "communications" || normalized === "communication" || normalized === "messages" || normalized === "client messages" || normalized === "chat")) return `/${workspace.slug}/communications`
        if (capabilitySet.has("relationships.view") && (normalized === "manual relationship" || normalized === "start relationship" || normalized === "new relationship" || normalized === "add relationship" || normalized === "manual client" || normalized === "add manual client" || normalized === "new client" || normalized === "add client")) return `/${workspace.slug}/relationships?create=relationship`
        if (canAccessPrivatePanels && (normalized === "teams" || normalized === "fulfilment teams" || normalized === "maintenance team" || normalized === "officers" || normalized === "responsible officers" || normalized === "global officer" || normalized === "maintenance routing")) return `/${workspace.slug}/settings#teams`
        if (canAccessPrivatePanels && (normalized === "lead gen settings" || normalized === "leadgen settings")) return `/${workspace.slug}/settings#leadgen`
        if (canAccessPrivatePanels && (normalized === "poll automation" || normalized === "lead gen automation")) return `/${workspace.slug}/settings#leadgen-automation`
        if (canAccessPrivatePanels && (normalized === "lead gen targeting" || normalized === "target industries" || normalized === "target locations")) return `/${workspace.slug}/settings#leadgen-targeting`
        if (canAccessPrivatePanels && (normalized === "lead gen sources" || normalized === "source settings")) return `/${workspace.slug}/settings#leadgen-sources`
        if (canAccessPrivatePanels && (normalized === "seed sources" || normalized === "seed source category")) return `/${workspace.slug}/settings#leadgen-sources-seed`
        if (canAccessPrivatePanels && (normalized === "business validation" || normalized === "business validation sources")) return `/${workspace.slug}/settings#leadgen-sources-business-validation`
        if (canAccessPrivatePanels && (normalized === "owner identity" || normalized === "owner identity discovery" || normalized === "owner discovery")) return `/${workspace.slug}/settings#leadgen-sources-owner-identity`
        if (canAccessPrivatePanels && (normalized === "owner phone" || normalized === "owner phone sources" || normalized === "phone discovery")) return `/${workspace.slug}/settings#leadgen-sources-owner-phone`
        if (canAccessPrivatePanels && (normalized === "phone validation" || normalized === "phone validation sources")) return `/${workspace.slug}/settings#leadgen-sources-phone-validation`
        return null
    }

    function submitSearch(event: ReactKeyboardEvent<HTMLInputElement>) {
        if (event.key !== "Enter") return false
        const href = searchResults[0]?.href ?? directSearchHref(query)
        if (!href) return false
        event.preventDefault()
        setSearchOpen(false)
        navigateSearchDestination(href)
        return true
    }

    function handleCreated(result: WorkspaceCreateActionState, target: WorkspaceCreateTarget) {
        setCreateTarget(null)
        if (!result.href) return
        const revision = mutationRevisionRef.current + 1
        mutationRevisionRef.current = revision
        const tabId = activeTabIdRef.current
        setTabs((existingTabs) => {
            const updatedTabs = existingTabs.map((tab) => tab.id === tabId ? { ...tab, seenRevision: revision } : tab)
            saveTabsState(updatedTabs, tabId)
            return updatedTabs
        })
        postToTab(tabId, { type: "activate", active: true, refresh: true })
        showCreationNotice({
            label: result.notice ?? (target === "relationship" ? "Relationship added" : target === "work-item" ? "Work item added" : target === "asset" ? "Asset added" : "OKR created"),
            href: result.href,
        })
    }

    function toggleSidebar() {
        if (sidebarTransitionTimeout.current) window.clearTimeout(sidebarTransitionTimeout.current)
        setSidebarTransitionEnabled(true)
        sidebarTransitionTimeout.current = window.setTimeout(() => {
            setSidebarTransitionEnabled(false)
            sidebarTransitionTimeout.current = null
        }, 240)
        setSidebarOpen((value) => !value)
    }

    function closeSidebarAfterNavigation() {
        if (window.matchMedia("(max-width: 767px)").matches) setSidebarOpen(false)
    }

    function navigateActiveTab(href: string) {
        const tabId = activeTabIdRef.current
        if (!tabId) return
        const url = normalizeWorkspaceUrl(href)
        const currentTab = tabs.find((candidate) => candidate.id === tabId)
        const isLoaded = loadedTabIdsRef.current.has(tabId)
        const alreadyPending = pendingNavigationRef.current.get(tabId) === url
        if (currentTab?.url === url && isLoaded && !alreadyPending) return
        beginTabNavigation(tabId, url)
        if (currentTab?.url !== url) {
            updateTabForShellNavigation(tabId, url)
            if (!routeCanShowRelationshipContext(url)) {
                setTabContextStatus(tabId, { supported: false, relationshipId: null, context: null })
                setTabContextOpen(tabId, false)
            }
        }

        pendingNavigationRef.current.set(tabId, url)
        requestTabFrameNavigation(tabId, url)
    }

    function isStandaloneBuilderHref(href: string) {
        return isWorkspaceOnboardingBuilderUrl(href, workspace.slug, window.location.origin)
    }

    function navigateWorkspaceDestination(href: string) {
        if (isStandaloneBuilderHref(href)) {
            openOnboardingBuilderWindow(href, workspace.slug)
            navigateActiveTab(href)
            return
        }
        navigateActiveTab(href)
    }

    function navigateSearchDestination(href: string) {
        if (isStandaloneBuilderHref(href)) {
            navigateWorkspaceDestination(href)
            return
        }
        if (workspaceRouteIsRecordDetail(href, workspace.slug, window.location.origin)) {
            openWorkspaceTab(href)
            return
        }
        navigateActiveTab(href)
    }

    function handleFrameLoad(tabId: string, expectedUrl: string) {
        markTabFrameReady(tabId)
        if (tabId === initialTab.id) markWorkspaceLaunch("initial_frame_loaded_ms")
        readyTabIdsRef.current.delete(tabId)
        setRouteLoadingTabId((current) => current === tabId ? null : current)
        const pendingUrl = pendingNavigationRef.current.get(tabId)
        const desiredUrl = pendingUrl ?? expectedUrl
        const repaired = ensureTabFrameLocation(tabId, desiredUrl)
        if (!pendingUrl && !repaired) completeTabNavigation(tabId)
        if (repaired) beginTabNavigation(tabId, desiredUrl)
        const active = tabId === activeTabIdRef.current
        window.requestAnimationFrame(() => postToTab(tabId, { type: "activate", active, refresh: false }))
    }

    const switchTab = useCallback((tab: WorkspaceTab) => {
        if (tab.id === activeTabIdRef.current) return
        const previousTabId = activeTabIdRef.current
        const refresh = tab.seenRevision < mutationRevisionRef.current
        const nextTabs = tabs.map((existingTab) => existingTab.id === tab.id && refresh
            ? { ...existingTab, seenRevision: mutationRevisionRef.current }
            : existingTab)
        activeTabIdRef.current = tab.id
        setTabs(nextTabs)
        activateWorkspaceTab(tab.id)
        saveTabsState(nextTabs, tab.id)
        window.requestAnimationFrame(() => {
            postToTab(previousTabId, { type: "activate", active: false, refresh: false })
            postToTab(tab.id, { type: "activate", active: true, refresh })
            const desiredUrl = pendingNavigationRef.current.get(tab.id) ?? tab.url
            if (ensureTabFrameLocation(tab.id, desiredUrl) && tab.id === activeTabIdRef.current) {
                beginTabNavigation(tab.id, desiredUrl)
            }
        })
    }, [activateWorkspaceTab, beginTabNavigation, ensureTabFrameLocation, postToTab, saveTabsState, tabs])

    useEffect(() => {
        function receiveBuilderReturn(event: MessageEvent<OnboardingBuilderWindowSignal>) {
            const message = event.data
            if (event.origin !== window.location.origin || message?.source !== ONBOARDING_BUILDER_WINDOW_SOURCE || message.workspaceSlug !== workspace.slug || message.type !== "return") return
            const builderTab = tabs.find((tab) => isWorkspaceOnboardingBuilderUrl(tab.url, workspace.slug, window.location.origin))
            if (builderTab) switchTab(builderTab)
            window.focus()
        }

        window.addEventListener("message", receiveBuilderReturn)
        return () => window.removeEventListener("message", receiveBuilderReturn)
    }, [switchTab, tabs, workspace.slug])

    function switchTabFromKeyboard(event: ReactKeyboardEvent<HTMLButtonElement>, tabIndex: number) {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return
        event.preventDefault()
        const nextIndex = event.key === "Home"
            ? 0
            : event.key === "End"
                ? visibleTabs.length - 1
                : (tabIndex + (event.key === "ArrowRight" ? 1 : -1) + visibleTabs.length) % visibleTabs.length
        const nextTab = visibleTabs[nextIndex]
        tabButtonRefs.current.get(nextTab.id)?.focus()
        switchTab(nextTab)
    }

    function beginTabDrag(event: ReactPointerEvent<HTMLButtonElement>, tabId: string) {
        if (tabs.length <= 1 || event.button !== 0 || editingTabId) return
        dragCleanupRef.current?.()
        const pointerId = event.pointerId
        const startX = event.clientX
        const startY = event.clientY
        const previousUserSelect = document.body.style.userSelect
        const previousCursor = document.body.style.cursor
        const draggedTab = tabs.find((tab) => tab.id === tabId)
        const draggedTabRect = event.currentTarget.parentElement?.getBoundingClientRect()
        const stripNode = tabStripRef.current
        if (!draggedTab || !draggedTabRect || !stripNode) return
        const dragStrip = stripNode
        const dragRect = draggedTabRect
        const dragTab = draggedTab
        const grabOffsetX = startX - draggedTabRect.left
        let orderedTabs = tabs
        let started = false

        event.currentTarget.setPointerCapture(pointerId)

        function updateDrag(clientX: number) {
            const stripRect = dragStrip.getBoundingClientRect()
            const previewLeft = Math.min(
                Math.max(clientX - stripRect.left - grabOffsetX, 0),
                Math.max(0, dragStrip.clientWidth - dragRect.width)
            )
            setTabDragPreview((current) => current ? { ...current, left: previewLeft } : current)

            const remainingTabs = orderedTabs.filter((tab) => tab.id !== tabId)
            const rects = remainingTabs
                .map((tab) => tabButtonRefs.current.get(tab.id)?.parentElement?.getBoundingClientRect() ?? null)
                .filter((rect): rect is DOMRect => Boolean(rect))
            if (rects.length !== remainingTabs.length) return

            const foundIndex = rects.findIndex((rect) => clientX < rect.left + rect.width / 2)
            const targetIndex = foundIndex === -1 ? rects.length : foundIndex
            setTabs((currentTabs) => {
                const nextTabs = reorderWorkspaceTabs(currentTabs, tabId, targetIndex)
                orderedTabs = nextTabs
                return nextTabs
            })
        }

        function move(pointerEvent: PointerEvent) {
            if (pointerEvent.pointerId !== pointerId) return
            const deltaX = pointerEvent.clientX - startX
            const deltaY = pointerEvent.clientY - startY
            if (!started) {
                if (Math.abs(deltaX) < 6 || Math.abs(deltaX) <= Math.abs(deltaY)) return
                started = true
                dragStartedTabIdRef.current = tabId
                lastTouchTabTapRef.current = { tabId: "", time: 0 }
                document.body.style.userSelect = "none"
                document.body.style.cursor = "grabbing"
                setDraggingTabId(tabId)
                const stripRect = dragStrip.getBoundingClientRect()
                setTabDragPreview({
                    left: Math.min(Math.max(pointerEvent.clientX - stripRect.left - grabOffsetX, 0), Math.max(0, dragStrip.clientWidth - dragRect.width)),
                    width: dragRect.width,
                    title: workspaceTabDisplayTitle(dragTab),
                    active: tabId === activeTabIdRef.current,
                })
            }
            pointerEvent.preventDefault()
            updateDrag(pointerEvent.clientX)
        }

        function finish() {
            window.removeEventListener("pointermove", move)
            window.removeEventListener("pointerup", up)
            window.removeEventListener("pointercancel", cancel)
            dragCleanupRef.current = null
            document.body.style.userSelect = previousUserSelect
            document.body.style.cursor = previousCursor
            dragStartedTabIdRef.current = ""
            setDraggingTabId(null)
            setTabDragPreview(null)

            if (!started) return
            saveTabsState(orderedTabs, activeTabIdRef.current)
            suppressTabClickRef.current = tabId
            window.setTimeout(() => {
                if (suppressTabClickRef.current === tabId) suppressTabClickRef.current = ""
            }, 0)
        }

        function up(pointerEvent: PointerEvent) {
            if (pointerEvent.pointerId === pointerId) finish()
        }

        function cancel(pointerEvent: PointerEvent) {
            if (pointerEvent.pointerId === pointerId) finish()
        }

        dragCleanupRef.current = finish
        window.addEventListener("pointermove", move, { passive: false })
        window.addEventListener("pointerup", up)
        window.addEventListener("pointercancel", cancel)
    }

    function startTabRename(tab: WorkspaceTab) {
        if (dragStartedTabIdRef.current) return
        setEditingTabId(tab.id)
        setEditingTabTitle(workspaceTabDisplayTitle(tab))
    }

    function saveTabRename(tabId: string) {
        const customTitle = normalizeWorkspaceTabCustomTitle(editingTabTitle)
        setTabs((currentTabs) => {
            const updatedTabs = currentTabs.map((tab) => tab.id === tabId
                ? { ...tab, customTitle: customTitle ?? undefined }
                : tab)
            saveTabsState(updatedTabs, activeTabIdRef.current)
            return updatedTabs
        })
        setEditingTabId(null)
        setEditingTabTitle("")
    }

    function cancelTabRename() {
        setEditingTabId(null)
        setEditingTabTitle("")
    }

    function handleTabTouchTap(event: ReactPointerEvent<HTMLButtonElement>, tab: WorkspaceTab) {
        if (event.pointerType !== "touch" || dragStartedTabIdRef.current === tab.id) return
        const now = event.timeStamp
        const previous = lastTouchTabTapRef.current
        if (previous.tabId === tab.id && now - previous.time <= 350) {
            lastTouchTabTapRef.current = { tabId: "", time: 0 }
            startTabRename(tab)
            return
        }
        lastTouchTabTapRef.current = { tabId: tab.id, time: now }
    }

    function addTab() {
        if (!canAddTab || tabs.length >= 8) return
        const currentTab = tabs.find((candidate) => candidate.id === activeTabIdRef.current)
        const url = currentTab?.url ?? defaultWorkspaceUrl
        const history = currentTab?.history.length ? [...currentTab.history] : [url]
        const historyIndex = currentTab ? Math.min(Math.max(currentTab.historyIndex, 0), history.length - 1) : 0
        const tab = {
            id: createTabId(),
            title: titleForUrl(url),
            url,
            history,
            historyIndex,
            seenRevision: currentTab?.seenRevision ?? mutationRevisionRef.current,
        }
        tabFrameOrderRef.current.push(tab.id)
        setTabFrameOrder([...tabFrameOrderRef.current])
        const nextTabs = [...tabs, tab]
        activeTabIdRef.current = tab.id
        setTabs(nextTabs)
        activateWorkspaceTab(tab.id)
        const currentContextStatus = currentTab ? contextStatusByTabRef.current[currentTab.id] : null
        const currentContextOpen = currentContextStatus?.supported ? true : currentTab ? contextOpenByTab[currentTab.id] ?? true : true
        sessionStorage.setItem(workspaceTabContextStorageKey(workspace.slug, tab.id), currentContextOpen ? "true" : "false")
        setContextOpenByTab((current) => ({ ...current, [tab.id]: currentContextOpen }))
        saveTabsState(nextTabs, tab.id)
    }

    function toggleContextPanel() {
        const tabId = activeTabIdRef.current
        if (!tabId) return
        const activeContextStatus = contextStatusByTabRef.current[tabId]
        if (!activeContextStatus?.supported) return
        const nextOpen = !(contextOpenByTab[tabId] ?? true)
        if (nextOpen) delete contextManualClosedByTabRef.current[tabId]
        else contextManualClosedByTabRef.current[tabId] = true
        setTabContextOpen(tabId, nextOpen)
    }

    function closeTab(tabId: string) {
        if (tabs.length <= 1) return
        const tabIndex = tabs.findIndex((tab) => tab.id === tabId)
        const closedTab = tabs[tabIndex]
        if (!closedTab) return
        closedTabsRef.current.push({ tab: closedTab, index: tabIndex })
        if (closedTabsRef.current.length > 20) closedTabsRef.current.shift()
        const nextTabs = tabs.filter((tab) => tab.id !== tabId)
        loadedTabIdsRef.current.delete(tabId)
        readyTabIdsRef.current.delete(tabId)
        pendingNavigationRef.current.delete(tabId)
        const navigationTimeout = navigationTimeoutRef.current.get(tabId)
        if (navigationTimeout) window.clearTimeout(navigationTimeout)
        navigationTimeoutRef.current.delete(tabId)
        const softFallback = softNavigationFallbackRef.current.get(tabId)
        if (softFallback) window.clearTimeout(softFallback)
        softNavigationFallbackRef.current.delete(tabId)
        navigationFallbackRef.current.delete(tabId)
        navigationErrorRef.current.delete(tabId)
        mutationIdsByTabRef.current.delete(tabId)
        setLoadedTabIds(new Set(loadedTabIdsRef.current))
        if (routeLoadingTabId === tabId) setRouteLoadingTabId(null)
        setRefreshingTabIds((current) => {
            if (!current.has(tabId)) return current
            const next = new Set(current)
            next.delete(tabId)
            return next
        })
        setNavigationStateByTab((current) => {
            if (!(tabId in current)) return current
            const next = { ...current }
            delete next[tabId]
            return next
        })
        setBackgroundMutationCounts((current) => {
            if (!(tabId in current)) return current
            const next = { ...current }
            delete next[tabId]
            return next
        })
        delete contextStatusByTabRef.current[tabId]
        delete contextManualClosedByTabRef.current[tabId]
        delete contextObstructedByTabRef.current[tabId]
        setContextStatusByTab((current) => {
            if (!(tabId in current)) return current
            const next = { ...current }
            delete next[tabId]
            return next
        })
        setContextObstructedByTab((current) => {
            if (!(tabId in current)) return current
            const next = { ...current }
            delete next[tabId]
            return next
        })
        const nextActiveTab = tabId === activeTabId
            ? nextTabs[Math.max(0, tabIndex - 1)] ?? nextTabs[0]
            : nextTabs.find((tab) => tab.id === activeTabId) ?? nextTabs[0]
        activeTabIdRef.current = nextActiveTab.id
        setTabs(nextTabs)
        activateWorkspaceTab(nextActiveTab.id)
        saveTabsState(nextTabs, nextActiveTab.id)
        if (tabId === activeTabId) {
            const refresh = nextActiveTab.seenRevision < mutationRevisionRef.current
            window.requestAnimationFrame(() => postToTab(nextActiveTab.id, { type: "activate", active: true, refresh }))
        }
    }

    const navButtonClass = "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-400 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-neutral-400"
    const sidebarItems = WORKSPACE_PANELS.filter((panel) => canAccessWorkspacePanel(panel, workspaceRole, workspaceCapabilities)).map((panel) => ({
        ...panel,
        href: workspacePanelHref(workspace.slug, panel),
        activeHrefs: ("activeRoutes" in panel ? panel.activeRoutes : [panel.route]).map((route) => `/${workspace.slug}/${route}`),
        icon: workspacePanelIcon(panel.key),
        meta: panel.key === "leadgen" ? LEADGEN_POLLING_SYSTEM_VERSION_LABEL : null,
        standalone: "standalone" in panel && panel.standalone === true,
    }))
    const canCreateOkr = canAccessPrivateWorkspacePanels(workspaceRole)
    const canCreateRelationship = canAccessWorkspacePanel(WORKSPACE_PANELS[0], workspaceRole, workspaceCapabilities)
    const canCreateLibraryItem = canAccessWorkspacePanel(WORKSPACE_PANELS[5], workspaceRole, workspaceCapabilities)
    const visibleTabs: WorkspaceTab[] = tabs.length ? tabs : [initialTab]
    const residentTabIdSet = new Set(residentTabIds)
    const frameTabs = orderWorkspaceTabsByStableIds(tabs, tabFrameOrder)
        .filter((tab) => tab.id === activeTabId || residentTabIdSet.has(tab.id))
    const activeTab = visibleTabs.find((tab) => tab.id === activeTabId) ?? visibleTabs[0]
    const activeTabLoaded = loadedTabIds.has(activeTab.id)
    const canGoBack = activeTabLoaded && activeTab.historyIndex > 0
    const canGoForward = activeTabLoaded && activeTab.historyIndex < activeTab.history.length - 1
    const activeContextStatus = contextStatusByTab[activeTab.id]
    const activeContextSupported = activeContextStatus?.supported === true
    const activeContextOpen = activeContextSupported && (contextOpenByTab[activeTab.id] ?? true)
    const activeContextObstructed = contextObstructedByTab[activeTab.id] === true
    const activeRelationshipContext = activeContextOpen && !activeContextObstructed ? activeContextStatus?.context ?? null : null
    const activePathname = new URL(activeTab.url, typeof window === "undefined" ? "http://localhost" : window.location.origin).pathname
    const activeRouteLoading = routeLoadingTabId === activeTabId
    const activeNavigation = navigationStateByTab[activeTabId]
    const activeBackgroundSaving = (backgroundMutationCounts[activeTabId] ?? 0) > 0
    const currentPresenceMember = workspaceMembers.find((member) => member.id === currentUserId) ?? { id: currentUserId, name: username, avatarSrc: avatarSrc ?? null }
    const profilePreviewMember = profileUserId ? workspaceMembers.find((member) => member.id === profileUserId) ?? null : null
    const workspacePresenceMembers = workspacePresenceRoster(workspaceMembers, activeWorkspaceUsers, currentUserId)

    useEffect(() => {
        if (!presenceSessionIdRef.current) presenceSessionIdRef.current = crypto.randomUUID()
        const supabase = createSupabaseBrowserClient()
        let disposed = false
        let reconnectTimeout: number | null = null
        let reconnectAttempt = 0
        let connecting = false
        let channel: WorkspacePresenceChannel | null = null

        function updateState(state: WorkspacePresenceState, error: string | null = null) {
            if (disposed) return
            const previous = presenceStateRef.current
            presenceStateRef.current = state
            setPresenceState(state)
            setPresenceError(error)
            if (state !== "connecting" && state !== "live" && state !== previous) {
                void fetch(`/api/workspaces/${encodeURIComponent(workspace.slug)}/activity/presence`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ state, error, sessionId: presenceSessionIdRef.current }),
                    keepalive: true,
                }).catch(() => undefined)
            }
        }

        async function track(candidate: WorkspacePresenceChannel) {
            await candidate.track({
                sessionId: presenceSessionIdRef.current,
                userId: currentUserId,
                name: presenceIdentityRef.current.name,
                avatarSrc: presenceIdentityRef.current.avatarSrc,
                activePath: tabsRef.current.find((tab) => tab.id === activeTabIdRef.current)?.url ?? null,
                updatedAt: new Date().toISOString(),
            } satisfies WorkspacePresencePayload)
        }

        function scheduleReconnect(message: string) {
            if (disposed || reconnectTimeout !== null) return
            reconnectAttempt += 1
            const delay = [1000, 2000, 5000, 10_000, 30_000][Math.min(reconnectAttempt - 1, 4)]
            updateState(reconnectAttempt >= 5 ? "error" : "reconnecting", message)
            reconnectTimeout = window.setTimeout(() => {
                reconnectTimeout = null
                void connect()
            }, delay)
        }

        async function connect() {
            if (disposed || connecting) return
            connecting = true
            if (reconnectTimeout !== null) {
                window.clearTimeout(reconnectTimeout)
                reconnectTimeout = null
            }
            updateState(reconnectAttempt ? "reconnecting" : "connecting")
            try {
                if (channel) {
                    const previous = channel
                    channel = null
                    presenceChannelRef.current = null
                    await supabase.removeChannel(previous)
                }
                const session = await supabase.auth.getSession()
                const accessToken = session.data.session?.access_token
                if (!accessToken) {
                    updateState("offline", "Sign in again to restore workspace presence.")
                    return
                }
                await supabase.realtime.setAuth(accessToken)
                if (disposed) return
                const candidate = supabase.channel(workspacePresenceTopic(workspace.slug), {
                    config: { private: true, presence: { key: presenceSessionIdRef.current } },
                })
                channel = candidate
                presenceChannelRef.current = candidate
                candidate
                    .on("presence", { event: "sync" }, () => {
                        if (disposed || channel !== candidate) return
                        setActiveWorkspaceUsers(visibleWorkspacePresence(candidate.presenceState<WorkspacePresencePayload>(), currentUserId, workspaceMembersRef.current))
                    })
                    .subscribe(async (status) => {
                        if (disposed || channel !== candidate) return
                        if (status === "SUBSCRIBED") {
                            reconnectAttempt = 0
                            updateState("live")
                            try {
                                await track(candidate)
                            } catch {
                                scheduleReconnect("Connected, but presence could not be announced.")
                            }
                        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
                            scheduleReconnect(`Workspace presence ${status.toLowerCase().replace(/_/g, " ")}.`)
                        }
                    })
            } catch (error) {
                scheduleReconnect(error instanceof Error ? error.message : "Workspace presence could not connect.")
            } finally {
                connecting = false
            }
        }

        function reconnectWhenAvailable() {
            if (document.visibilityState === "visible" && presenceStateRef.current !== "live") void connect()
        }

        const authSubscription = supabase.auth.onAuthStateChange((_event, session) => {
            if (!session?.access_token || disposed) return
            window.setTimeout(() => { void connect() }, 0)
        })
        window.addEventListener("online", reconnectWhenAvailable)
        window.addEventListener("focus", reconnectWhenAvailable)
        document.addEventListener("visibilitychange", reconnectWhenAvailable)
        void connect()

        return () => {
            disposed = true
            if (reconnectTimeout !== null) window.clearTimeout(reconnectTimeout)
            authSubscription.data.subscription.unsubscribe()
            window.removeEventListener("online", reconnectWhenAvailable)
            window.removeEventListener("focus", reconnectWhenAvailable)
            document.removeEventListener("visibilitychange", reconnectWhenAvailable)
            presenceChannelRef.current = null
            setActiveWorkspaceUsers([])
            if (channel) void supabase.removeChannel(channel)
        }
    }, [currentUserId, workspace.slug])

    useEffect(() => {
        workspaceMembersRef.current = workspaceMembers
        presenceIdentityRef.current = { name: currentPresenceMember.name, avatarSrc: currentPresenceMember.avatarSrc }
        const channel = presenceChannelRef.current
        if (!channel || presenceState !== "live") return
        void channel.track({
            sessionId: presenceSessionIdRef.current,
            userId: currentUserId,
            name: currentPresenceMember.name,
            avatarSrc: currentPresenceMember.avatarSrc,
            activePath: activeTab.url,
            updatedAt: new Date().toISOString(),
        } satisfies WorkspacePresencePayload).catch(() => {
            presenceStateRef.current = "reconnecting"
            setPresenceState("reconnecting")
            setPresenceError("Workspace presence could not update the active page.")
        })
    }, [activeTab.url, currentPresenceMember.avatarSrc, currentPresenceMember.name, currentUserId, presenceState, workspaceMembers])

    useEffect(() => {
        if (presenceState !== "live") return
        markWorkspaceLaunch("presence_ready_ms")
        reportWorkspaceLaunch({
            stage: "presence",
            workspaceSlug: workspace.slug,
            initialUrl: initialTab.url,
            serverTiming: launchServerTiming,
        })
    }, [initialTab.url, launchServerTiming, presenceState, workspace.slug])

    function retryActiveNavigation() {
        if (!activeNavigation) return
        beginTabNavigation(activeTabId, activeNavigation.requestedUrl)
        updateTabForShellNavigation(activeTabId, activeNavigation.requestedUrl)
        pendingNavigationRef.current.set(activeTabId, activeNavigation.requestedUrl)
        requestTabFrameNavigation(activeTabId, activeNavigation.requestedUrl)
    }

    function viewCreatedRecord() {
        if (!creationNotice) return
        if (creationNoticeTimeoutRef.current) window.clearTimeout(creationNoticeTimeoutRef.current)
        creationNoticeTimeoutRef.current = null
        const { href } = creationNotice
        setCreationNotice(null)
        if (workspaceRouteIsRecordDetail(href, workspace.slug, window.location.origin)) openWorkspaceTab(href)
        else navigateActiveTab(href)
    }

    return <div ref={shellRootRef} data-workspace-shell-root>
        {/* Keep this stacking context above the sidebar so account and search popups remain clickable. */}
        <header data-workspace-topbar className="fixed left-0 top-0 z-[55] h-14 w-full border-b border-neutral-800 bg-neutral-950/95 text-white shadow-lg shadow-black/20 backdrop-blur">
            <div className="grid h-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 sm:px-6 md:grid-cols-[minmax(0,1fr)_minmax(20rem,40rem)_minmax(0,1fr)] md:gap-4">
                <div className="flex min-w-0 items-center gap-2.5">
                    <WorkspaceLogo src={workspaceLogoSrc} name={workspace.name} />
                    <p className="min-w-0 truncate text-sm font-semibold text-neutral-100">{workspace.name}</p>
                    <button data-icon-button type="button" onClick={toggleSidebar} aria-label="Toggle sidebar" aria-expanded={sidebarOpen} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-neutral-400 transition hover:text-white md:h-8 md:w-8">
                        <SidebarIcon />
                    </button>
                </div>

                <div ref={desktopSearchRef} className="relative hidden min-w-0 items-center gap-1 md:flex">
                    <button data-icon-button type="button" onClick={goBack} disabled={!canGoBack} aria-label="Go back" className={navButtonClass}>
                        <ArrowLeftIcon />
                    </button>
                    <button data-icon-button type="button" onClick={goForward} disabled={!canGoForward} aria-label="Go forward" className={navButtonClass}>
                        <ArrowRightIcon />
                    </button>
                    <button data-icon-button type="button" onClick={reloadWorkspace} aria-label="Reload workspace" className={navButtonClass}>
                        <ReloadIcon />
                    </button>
                    <label className="relative block min-w-0 flex-1">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"><SearchIcon /></span>
                        <input ref={desktopSearchInputRef} value={query} onKeyDown={submitSearch} onChange={(event) => { setQuery(event.target.value); openDesktopSearch() }} onFocus={openDesktopSearch} aria-label="Search Betelgeze" placeholder="Search relationships, work, leads..." className="h-9 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 pl-9 pr-16 text-sm text-neutral-300 outline-none transition placeholder:text-neutral-600 focus:border-neutral-600 focus:ring-2 focus:ring-white/10" />
                        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-neutral-800 px-1.5 py-0.5 text-[10px] leading-none text-neutral-500">{searchShortcutLabel}</span>
                    </label>
                    <WorkspacePresenceAvatars members={workspacePresenceMembers} state={presenceState} error={presenceError} onOpenProfile={setProfileUserId} />
                    <WorkspaceMutationStatus state={activeBackgroundSaving ? "saving" : backgroundMutationState} error={backgroundMutationError} />
                    {searchOpen && (
                        <div className="absolute left-[6.5rem] right-0 top-11 z-[70] max-h-[32rem] overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 shadow-2xl shadow-black/40">
                            <div className="max-h-[32rem] overflow-y-auto">
                                {query.trim().length < 2 && <p className="px-3 py-3 text-sm text-neutral-500">Type at least two characters.</p>}
                                {query.trim().length >= 2 && searchLoading && <p className="px-3 py-3 text-sm text-neutral-500">Searching...</p>}
                                {query.trim().length >= 2 && !searchLoading && searchResults.length === 0 && <p className="px-3 py-3 text-sm text-neutral-500">No core results found.</p>}
                                {query.trim().length >= 2 && !searchLoading && searchResults.map((item) => (
                                    <div key={item.id} className="border-b border-neutral-900 last:border-0">
                                        <Link href={item.href} data-global-loading="false" target={isStandaloneBuilderHref(item.href) ? "_blank" : undefined} rel={isStandaloneBuilderHref(item.href) ? "noopener noreferrer" : undefined} className="block px-3 py-2 hover:bg-neutral-900" onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); setSearchOpen(false); navigateSearchDestination(item.href) }}>
                                            <SearchResultContent item={item} />
                                        </Link>
                                        {item.hubHref && item.hubHref !== item.href && (
                                            <Link href={item.hubHref} data-global-loading="false" className="block px-3 pb-2 text-xs text-neutral-500 hover:text-neutral-200" onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); setSearchOpen(false); navigateActiveTab(item.hubHref!) }}>
                                                View in Relationship Hub
                                            </Link>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-end gap-2.5">
                    <div ref={mobileSearchRef} className="md:hidden">
                        {searchOpen && (
                            <div className="fixed left-3 right-3 top-16 z-[70] max-h-[72vh] overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 shadow-2xl shadow-black/40">
                                <div className="border-b border-neutral-800 p-3">
                                    <label className="relative block">
                                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"><SearchIcon /></span>
                                        <input ref={mobileSearchInputRef} value={query} onKeyDown={submitSearch} onChange={(event) => setQuery(event.target.value)} aria-label="Search Betelgeze" placeholder="Search relationships, work, leads..." className="h-11 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 pl-10 text-base text-neutral-200 outline-none transition placeholder:text-neutral-600 focus:border-neutral-600 focus:ring-2 focus:ring-white/10" />
                                    </label>
                                </div>
                                <div className="max-h-[calc(72vh-4.25rem)] overflow-y-auto">
                                    {query.trim().length < 2 && <p className="px-3 py-3 text-sm text-neutral-500">Type at least two characters.</p>}
                                    {query.trim().length >= 2 && searchLoading && <p className="px-3 py-3 text-sm text-neutral-500">Searching...</p>}
                                    {query.trim().length >= 2 && !searchLoading && searchResults.length === 0 && <p className="px-3 py-3 text-sm text-neutral-500">No core results found.</p>}
                                    {query.trim().length >= 2 && !searchLoading && searchResults.map((item) => (
                                        <div key={item.id} className="border-b border-neutral-900 last:border-0">
                                            <Link href={item.href} data-global-loading="false" target={isStandaloneBuilderHref(item.href) ? "_blank" : undefined} rel={isStandaloneBuilderHref(item.href) ? "noopener noreferrer" : undefined} className="block px-3 py-3 hover:bg-neutral-900" onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); setSearchOpen(false); navigateSearchDestination(item.href) }}>
                                                <SearchResultContent item={item} mobile />
                                            </Link>
                                            {item.hubHref && item.hubHref !== item.href && (
                                                <Link href={item.hubHref} data-global-loading="false" className="block px-3 pb-3 text-xs text-neutral-500 hover:text-neutral-200" onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); setSearchOpen(false); navigateActiveTab(item.hubHref!) }}>
                                                    View in Relationship Hub
                                                </Link>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="hidden items-center gap-0.5 md:flex" aria-label="Create">
                        {canCreateRelationship && <button data-icon-button type="button" onClick={() => openCreate("relationship")} aria-label="Add relationship" title="Add relationship" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-neutral-400 transition hover:text-white md:h-9 md:w-9">
                            <RelationshipsIcon />
                        </button>}
                        {canCreateLibraryItem && <button data-icon-button type="button" onClick={() => openCreate("work-item")} aria-label="Add work item" title="Add work item" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-neutral-400 transition hover:text-white md:h-9 md:w-9">
                            <WorkIcon />
                        </button>}
                        {canCreateLibraryItem && <button data-icon-button type="button" onClick={() => openCreate("asset")} aria-label="Add asset" title="Add asset" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-neutral-400 transition hover:text-white md:h-9 md:w-9">
                            <AssetsIcon />
                        </button>}
                        {canCreateOkr && <button data-icon-button type="button" onClick={() => openCreate("okr")} aria-label="Create OKR" title="Create OKR" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-neutral-400 transition hover:text-white md:h-9 md:w-9">
                            <OkrIcon />
                        </button>}
                    </div>
                    <div className="flex h-9 items-center -space-x-2 md:space-x-0">
                        <div className="flex h-9 items-center md:hidden"><WorkspacePresenceAvatars members={workspacePresenceMembers} state={presenceState} error={presenceError} onOpenProfile={setProfileUserId} /></div>
                        <AccountMenu username={username} email={email} avatarSrc={avatarSrc} workspaceId={workspace.id} workspaceName={workspace.name} leaveAction={leaveAction} buttonClassName="relative z-20 h-9 w-9" />
                    </div>
                </div>
            </div>
        </header>

        {profileUserId ? <WorkspaceMemberProfileModal
            key={profileUserId}
            workspaceSlug={workspace.slug}
            userId={profileUserId}
            initialProfile={profilePreviewMember ? { displayName: profilePreviewMember.name, avatarSrc: profilePreviewMember.avatarSrc } : null}
            active={profileUserId === currentUserId || activeWorkspaceUsers.some((member) => member.userId === profileUserId)}
            canMessage={workspaceRole === "owner" || workspaceRole === "admin"}
            onClose={() => setProfileUserId(null)}
            onMessage={(userId) => { setProfileUserId(null); navigateActiveTab(`/${workspace.slug}/communications?mode=team&dm=${userId}`) }}
        /> : null}

        {createTarget ? <WorkspaceCreateModal
            key={createTarget}
            target={createTarget}
            workspace={workspace}
            currentUserId={currentUserId}
            username={username}
            currentUserRole={workspaceRole}
            createRelationshipAction={createRelationshipAction}
            createWorkItemAction={createWorkItemAction}
            createAssetAction={createAssetAction}
            createOkrAction={createOkrAction}
            onClose={() => setCreateTarget(null)}
            onCreated={handleCreated}
        /> : null}


        <div data-workspace-tabbar className={`fixed top-14 z-40 h-11 border-b border-neutral-800 bg-neutral-950/95 text-white shadow-lg shadow-black/10 backdrop-blur ${sidebarTransitionEnabled ? "transition-[left,width] duration-200 ease-out" : ""}`}>
            <div className="flex h-full min-w-0 items-end gap-2 px-2 pt-1">
                <div ref={tabStripRef} role="tablist" aria-label="Workspace tabs" className="relative flex h-full min-w-0 flex-1 items-end gap-1 overflow-x-auto overflow-y-hidden md:overflow-hidden">
                    {visibleTabs.map((tab) => {
                        const active = tab.id === activeTabId
                        const dragging = tab.id === draggingTabId
                        const displayTitle = workspaceTabDisplayTitle(tab)
                        const communicationsTab = workspaceTabIsCommunications(tab.url, workspace.slug, "http://localhost")
                        return (
                            <div key={tab.id} className={`group flex h-9 min-w-32 max-w-56 shrink-0 items-center rounded-t-lg border px-2 text-sm transition-[opacity,background-color,border-color] duration-150 ${dragging ? "opacity-0" : ""} ${active ? "border-neutral-700 border-b-neutral-950 bg-neutral-950 text-white" : "border-transparent bg-neutral-900/55 text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"}`}>
                                {editingTabId === tab.id ? (
                                    <input
                                        ref={tabTitleInputRef}
                                        value={editingTabTitle}
                                        maxLength={60}
                                        aria-label={`Rename ${displayTitle} tab`}
                                        onChange={(event) => setEditingTabTitle(event.target.value)}
                                        onBlur={() => saveTabRename(tab.id)}
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter") event.currentTarget.blur()
                                            if (event.key === "Escape") {
                                                event.preventDefault()
                                                cancelTabRename()
                                            }
                                        }}
                                        className="h-7 min-w-0 flex-1 rounded border border-neutral-600 bg-black px-2 text-sm text-white outline-none focus:border-neutral-400"
                                    />
                                ) : <button
                                    ref={(node) => { if (node) tabButtonRefs.current.set(tab.id, node); else tabButtonRefs.current.delete(tab.id) }}
                                    role="tab"
                                    aria-selected={active}
                                    title={displayTitle}
                                    tabIndex={active ? 0 : -1}
                                    type="button"
                                    onPointerEnter={() => scheduleTabWarm(tab.id)}
                                    onPointerLeave={() => cancelScheduledTabWarm(tab.id)}
                                    onFocus={() => warmWorkspaceTab(tab.id)}
                                    onPointerDown={(event) => {
                                        warmWorkspaceTab(tab.id)
                                        beginTabDrag(event, tab.id)
                                    }}
                                    onPointerUp={(event) => handleTabTouchTap(event, tab)}
                                    onDoubleClick={(event) => {
                                        event.preventDefault()
                                        startTabRename(tab)
                                    }}
                                    onKeyDown={(event) => switchTabFromKeyboard(event, visibleTabs.indexOf(tab))}
                                    onClick={() => {
                                        if (suppressTabClickRef.current === tab.id) return
                                        switchTab(tab)
                                    }}
                                    className={`min-w-0 flex-1 touch-pan-y truncate text-left ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
                                >
                                    <span className="flex min-w-0 items-center gap-1.5"><span className="truncate">{displayTitle}</span>{communicationsTab && !active ? <UnreadMessageCount count={communicationsUnreadCount} label="unread Communications messages" /> : null}{navigationStateByTab[tab.id]?.status === "loading" || refreshingTabIds.has(tab.id) ? <span aria-label={navigationStateByTab[tab.id]?.status === "loading" ? "Loading" : "Refreshing"} className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-neutral-400" /> : navigationStateByTab[tab.id]?.status === "error" ? <span aria-label="Navigation failed" className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" /> : null}</span>
                                </button>}
                                {visibleTabs.length > 1 && (
                                    <button data-icon-button type="button" onClick={() => closeTab(tab.id)} aria-label={`Close ${displayTitle} tab`} className="ml-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-neutral-500 opacity-80 transition hover:bg-neutral-800 hover:text-white group-hover:opacity-100">
                                        <span aria-hidden="true" className="text-base leading-none">×</span>
                                    </button>
                                )}
                            </div>
                        )
                    })}
                    {tabDragPreview && (
                        <div
                            aria-hidden="true"
                            className={`pointer-events-none absolute bottom-0 z-30 flex h-9 items-center rounded-t-lg border px-2 text-sm shadow-xl shadow-black/40 ${tabDragPreview.active ? "border-neutral-600 border-b-neutral-950 bg-neutral-950 text-white" : "border-neutral-700 bg-neutral-900 text-neutral-200"}`}
                            style={{ left: tabDragPreview.left, width: tabDragPreview.width }}
                        >
                            <span className="min-w-0 flex-1 truncate text-left">{tabDragPreview.title}</span>
                            <span className="ml-1 inline-flex h-7 w-7 shrink-0 items-center justify-center text-base leading-none text-neutral-400">×</span>
                        </div>
                    )}
                    <button data-icon-button type="button" onClick={addTab} disabled={!canAddTab} aria-label="Open new tab" className="mb-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-400 transition hover:bg-neutral-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-neutral-400">
                        <span aria-hidden="true" className="text-xl leading-none">+</span>
                    </button>
                </div>
                <button data-icon-button type="button" onClick={toggleContextPanel} disabled={!activeContextSupported} aria-label={!activeContextSupported ? "Relationship context unavailable" : activeContextOpen ? "Hide relationship context" : "Show relationship context"} aria-pressed={activeContextSupported ? activeContextOpen : undefined} className="mb-1 hidden h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-400 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-neutral-400 md:inline-flex">
                    <ContextPanelIcon />
                </button>
            </div>
        </div>

        <div data-workspace-tab-panels className={`fixed bottom-0 top-[6.25rem] z-30 overflow-hidden bg-neutral-950 ${sidebarTransitionEnabled ? "transition-[left,width] duration-200 ease-out" : ""}`}>
            {frameTabs.map((tab) => (
                <WorkspaceTabFrame
                    key={tab.id}
                    tab={tab}
                    active={tab.id === activeTabId}
                    assignRef={assignTabFrameRef}
                    onLoad={() => handleFrameLoad(tab.id, tab.url)}
                />
            ))}
            {tabsHydrated && activeRouteLoading && (
                <div className="absolute inset-0 z-20 bg-neutral-950" aria-hidden="true" />
            )}
            {!loadedTabIds.has(activeTabId) && !activeRouteLoading && (
                <div className="absolute inset-0 z-10 overflow-y-auto bg-neutral-950">
                    <WorkspaceTabOpeningState url={activeTab.url} workspaceSlug={workspace.slug} detailPreview={activeTab.detailPreview} />
                </div>
            )}
            {tabsHydrated && activeNavigation?.status === "error" ? <div role="alert" className="absolute right-4 top-4 z-20 flex items-center gap-3 rounded-lg border border-red-500/30 bg-neutral-950/95 px-3 py-2 text-xs text-red-200 shadow-xl"><span>{activeNavigation.error}</span><button type="button" onClick={retryActiveNavigation} className="font-medium text-white underline decoration-neutral-600 underline-offset-2">Retry</button></div> : null}
        </div>

        {activeRelationshipContext && !activeRouteLoading && (
            <ShellRelationshipContextPanel
                context={activeRelationshipContext}
                workspaceSlug={workspace.slug}
                onNavigate={navigateActiveTab}
                workspaceCapabilities={workspaceCapabilities}
            />
        )}

        {activeRouteLoading && <LoadingOverlay />}

        {creationNotice ? <WorkspaceSuccessNotice label={creationNotice.label} actionLabel="View" onAction={viewCreatedRecord} /> : null}

        {sidebarOpen && <button type="button" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)} className="fixed inset-x-0 bottom-0 top-14 z-[45] cursor-default md:hidden" />}

        <aside data-workspace-sidebar aria-hidden={!sidebarOpen} className={`fixed left-0 top-14 z-50 h-[calc(100dvh-3.5rem)] w-72 border-r border-neutral-800 bg-neutral-950 ${sidebarTransitionEnabled ? "transition-transform duration-200 ease-out" : ""} ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
            <nav className="flex h-full touch-pan-y flex-col gap-2 overflow-y-auto overscroll-contain px-4 py-5 md:gap-1 md:overflow-visible md:overscroll-auto md:px-3 md:py-4">
                <div className="flex h-10 items-center border-b border-neutral-800 pb-2 md:hidden">
                    <button data-icon-button type="button" onClick={() => { goBack(); closeSidebarAfterNavigation() }} disabled={!canGoBack} aria-label="Go back" className={navButtonClass}>
                        <ArrowLeftIcon />
                    </button>
                    <button data-icon-button type="button" onClick={() => { goForward(); closeSidebarAfterNavigation() }} disabled={!canGoForward} aria-label="Go forward" className={navButtonClass}>
                        <ArrowRightIcon />
                    </button>
                    <button data-icon-button type="button" onClick={reloadWorkspace} aria-label="Reload workspace" className={navButtonClass}>
                        <ReloadIcon />
                    </button>
                    <button data-icon-button type="button" onClick={openMobileSearch} aria-label="Search Betelgeze" className={`${navButtonClass} ml-auto`}>
                        <SearchIcon />
                    </button>
                </div>
                {sidebarItems.map((item) => {
                    const active = item.activeHrefs?.some((href) => activePathname === href || activePathname.startsWith(`${href}/`))
                        ?? (item.href === defaultWorkspaceUrl
                        ? activePathname === defaultWorkspaceUrl
                        : activePathname === item.href || activePathname.startsWith(`${item.href}/`))
                    const itemClassName = `flex min-h-12 items-center gap-3 rounded-lg px-4 text-base transition md:min-h-10 md:px-3 md:text-sm ${active ? "bg-neutral-900 text-white" : "text-neutral-400 hover:bg-neutral-900/70 hover:text-white"}`

                    return (
                        <Link key={item.key} href={item.href} target={item.standalone ? "_blank" : undefined} rel={item.standalone ? "noopener noreferrer" : undefined} data-global-loading="false" onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); navigateWorkspaceDestination(item.href); closeSidebarAfterNavigation() }} className={itemClassName}>
                            <span className="shrink-0">{item.icon}</span>
                            <span className="min-w-0 flex-1 truncate">{item.label}</span>
                            {item.meta && <span className="shrink-0 font-mono text-[11px] text-neutral-500">{item.meta}</span>}
                        </Link>
                    )
                })}
                <div className="mt-auto border-t border-neutral-800 pt-3 md:hidden">
                    {canCreateRelationship && <button type="button" onClick={() => { openCreate("relationship"); closeSidebarAfterNavigation() }} className="flex min-h-10 w-full items-center gap-3 rounded-lg px-4 text-left text-sm text-neutral-500 transition hover:bg-neutral-900/70 hover:text-neutral-200">
                        <RelationshipsIcon />
                        <span>Add relationship</span>
                    </button>}
                    {canCreateLibraryItem && <button type="button" onClick={() => { openCreate("work-item"); closeSidebarAfterNavigation() }} className="flex min-h-10 w-full items-center gap-3 rounded-lg px-4 text-left text-sm text-neutral-500 transition hover:bg-neutral-900/70 hover:text-neutral-200">
                        <WorkIcon />
                        <span>Add work item</span>
                    </button>}
                    {canCreateLibraryItem && <button type="button" onClick={() => { openCreate("asset"); closeSidebarAfterNavigation() }} className="flex min-h-10 w-full items-center gap-3 rounded-lg px-4 text-left text-sm text-neutral-500 transition hover:bg-neutral-900/70 hover:text-neutral-200">
                        <AssetsIcon />
                        <span>Add asset</span>
                    </button>}
                    {canCreateOkr && <button type="button" onClick={() => { openCreate("okr"); closeSidebarAfterNavigation() }} className="flex min-h-10 w-full items-center gap-3 rounded-lg px-4 text-left text-sm text-neutral-500 transition hover:bg-neutral-900/70 hover:text-neutral-200">
                        <OkrIcon />
                        <span>Create OKR</span>
                    </button>}
                </div>
            </nav>
        </aside>
    </div>
}
