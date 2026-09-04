export function ClientBrandLogo({
    logoSrc,
    workspaceName,
    className = "h-9 max-w-48",
    fallbackClassName = "text-xl font-semibold text-[var(--onboarding-primary,#1E3A5F)]",
}: {
    logoSrc?: string | null
    workspaceName: string
    className?: string
    fallbackClassName?: string
}) {
    if (!logoSrc) return <span className={fallbackClassName}>{workspaceName}</span>
    // The source is a same-origin, token- or workspace-scoped SVG endpoint.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logoSrc} alt={`${workspaceName} logo`} width={240} height={64} className={`${className} w-auto object-contain object-left`} />
}
