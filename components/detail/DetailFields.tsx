import type { ReactNode } from "react"

export type DetailFieldIcon =
    | "status"
    | "schedule"
    | "user"
    | "person"
    | "identity"
    | "contact"
    | "parent"
    | "dependency"
    | "relationship"
    | "priority"
    | "services"
    | "modules"
    | "description"
    | "progress"
    | "file"
    | "size"
    | "source"
    | "time"
    | "activity"
    | "timeline"

function DetailFieldIconMark({ kind }: { kind: DetailFieldIcon }) {
    const paths: Record<DetailFieldIcon, ReactNode> = {
        status: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /></>,
        schedule: <><path d="M7 3v3M17 3v3M4 9h16" /><rect x="4" y="5" width="16" height="15" rx="2" /></>,
        user: <><circle cx="12" cy="8" r="4" /><path d="M4.5 20c.8-4 3.3-6 7.5-6s6.7 2 7.5 6" /></>,
        person: <><circle cx="8" cy="8" r="3" /><circle cx="16" cy="8" r="3" /><path d="M3 20c.5-4 2.2-6 5-6M21 20c-.5-4-2.2-6-5-6" /></>,
        identity: <><circle cx="12" cy="8" r="4" /><path d="M4.5 20c.8-4 3.3-6 7.5-6s6.7 2 7.5 6" /></>,
        contact: <><path d="M5 5h14v14H5z" /><path d="m6 7 6 5 6-5" /></>,
        parent: <><path d="M6 5h5v5H6zM13 14h5v5h-5zM8.5 10v2a4 4 0 0 0 4 4h.5" /></>,
        dependency: <><circle cx="7" cy="7" r="3" /><circle cx="17" cy="17" r="3" /><path d="M9.5 9.5l5 5" /></>,
        relationship: <><circle cx="8" cy="9" r="3" /><circle cx="16" cy="9" r="3" /><path d="M2.5 20c.5-3.3 2.3-5 5.5-5M21.5 20c-.5-3.3-2.3-5-5.5-5M10 17h4" /></>,
        priority: <><path d="M6 21V4M6 5h11l-2 4 2 4H6" /></>,
        services: <><path d="M4 7h16M4 12h16M4 17h16" /><circle cx="7" cy="7" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="17" cy="17" r="1" /></>,
        modules: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
        description: <><path d="M5 5h14M5 9h14M5 13h10M5 17h12" /></>,
        progress: <><path d="M5 19V9M12 19V5M19 19v-7" /></>,
        file: <><path d="M6 3h8l4 4v14H6zM14 3v5h5" /></>,
        size: <><path d="M5 19 19 5M9 5h10v10" /></>,
        source: <><circle cx="6" cy="12" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="18" cy="18" r="2" /><path d="m8 11 8-4M8 13l8 4" /></>,
        time: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
        activity: <><path d="M4 12h4l2-6 4 12 2-6h4" /></>,
        timeline: <><path d="M7 3v3M17 3v3M4 9h16" /><rect x="4" y="5" width="16" height="15" rx="2" /></>,
    }
    return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0">{paths[kind]}</svg>
}

export function DetailFields({ children, className = "" }: { children: ReactNode; className?: string }) {
    return <section className={`mt-5 grid grid-cols-1 lg:grid-cols-2 ${className}`}>{children}</section>
}

export function DetailField({ label, icon, children, className = "" }: { label: string; icon: DetailFieldIcon; children: ReactNode; className?: string }) {
    return <div className={`grid min-h-10 grid-cols-[8rem_minmax(0,1fr)] items-start gap-2 border-b border-neutral-900 py-2 sm:grid-cols-[9rem_minmax(0,1fr)] ${className}`}>
        <p className="flex items-center gap-2 pt-0.5 text-sm text-neutral-500"><DetailFieldIconMark kind={icon} /><span>{label}</span></p>
        <div className="min-w-0 text-sm text-neutral-200">{children}</div>
    </div>
}
