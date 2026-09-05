export function WorkspaceBannerPending() {
    return <div aria-label="Loading workspace banner" aria-busy="true" className="relative mb-16 h-[115px] animate-pulse rounded-xl border border-neutral-800 bg-neutral-900 sm:h-48 sm:rounded-2xl">
        <div className="absolute bottom-0 left-4 h-[112px] w-[112px] translate-y-1/2 rounded-full border-4 border-neutral-950 bg-neutral-900 sm:left-7 sm:h-[108px] sm:w-[108px]" />
    </div>
}
