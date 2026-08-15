export function ReplyIcon({ className = "h-4 w-4" }: { className?: string }) {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className={`${className} fill-none stroke-current`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 8-5 4 5 4" /><path d="M5 12h8a6 6 0 0 1 6 6" /></svg>
}

export function DeleteIcon({ className = "h-4 w-4" }: { className?: string }) {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className={`${className} fill-none stroke-current`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16" /><path d="m9 7 .5-3h5l.5 3" /><path d="m7 7 1 13h8l1-13" /><path d="M10 11v5M14 11v5" /></svg>
}
