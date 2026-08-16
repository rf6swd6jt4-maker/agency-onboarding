/* eslint-disable @next/next/no-img-element */
export function Avatar({
    src,
    name,
    className = "h-12 w-12",
}: {
    src?: string | null
    name: string
    className?: string
}) {
    if (src) {
        return (
            <img
                src={src}
                alt={`${name} profile picture`}
                width={96}
                height={96}
                decoding="async"
                className={`${className} block shrink-0 aspect-square overflow-hidden rounded-full object-cover`}
                style={{ aspectRatio: "1 / 1", objectFit: "cover" }}
            />
        )
    }

    return (
        <div
            aria-label={`${name} profile picture`}
            className={`${className} flex shrink-0 aspect-square items-center justify-center overflow-hidden rounded-full bg-neutral-800 text-neutral-400`}
            style={{ aspectRatio: "1 / 1" }}
        >
            <svg viewBox="0 0 24 24" fill="none" className="h-[52%] w-[52%]" aria-hidden="true">
                <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" fill="currentColor" />
                <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" fill="currentColor" />
            </svg>
        </div>
    )
}
