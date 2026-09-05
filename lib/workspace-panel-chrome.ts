export function workspaceRouteUsesSharedBanner(pathname: string) {
    const segments = pathname.split("/").filter(Boolean)
    const panel = segments[1]
    const nested = segments.slice(2)

    if (panel === "admin") {
        return nested.length === 0 || nested[0] === "activity" || (nested.length === 1 && ["maintenance", "okrs"].includes(nested[0]))
    }
    if (panel === "leadgen") {
        return nested.length === 0 || (nested.length === 1 && nested[0] === "polls")
    }

    return nested.length === 0 && [
        "appointment-setting",
        "assets",
        "onboarding",
        "relationships",
        "work",
        "work-items",
    ].includes(panel)
}
