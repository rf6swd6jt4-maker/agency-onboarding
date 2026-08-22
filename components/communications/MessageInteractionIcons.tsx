export function ReplyIcon({ className = "h-4 w-4" }: { className?: string }) {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className={`${className} fill-none stroke-current`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 8-5 4 5 4" /><path d="M5 12h8a6 6 0 0 1 6 6" /></svg>
}

export function DeleteIcon({ className = "h-4 w-4" }: { className?: string }) {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className={`${className} fill-none stroke-current`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16" /><path d="m9 7 .5-3h5l.5 3" /><path d="m7 7 1 13h8l1-13" /><path d="M10 11v5M14 11v5" /></svg>
}

export function EditIcon({ className = "h-4 w-4" }: { className?: string }) {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className={`${className} fill-none stroke-current`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></svg>
}

export function CheckIcon({ className = "h-4 w-4" }: { className?: string }) {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className={`${className} fill-none stroke-current`} strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6" /></svg>
}

export function CancelIcon({ className = "h-4 w-4" }: { className?: string }) {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className={`${className} fill-none stroke-current`} strokeWidth="2" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
}

export function SaveIcon({ className = "h-4 w-4" }: { className?: string }) {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className={`${className} fill-none stroke-current`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 20h14" /></svg>
}

export function CopyIcon({ className = "h-4 w-4" }: { className?: string }) {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className={`${className} fill-none stroke-current`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>
}

export function PinIcon({ className = "h-4 w-4" }: { className?: string }) {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className={`${className} fill-none stroke-current`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m14 4 6 6" /><path d="M16.5 7.5 13 11l1 4-2 2-5-5 2-2 4 1 3.5-3.5Z" /><path d="m9.5 14.5-5 5" /></svg>
}

export function ReactIcon({ className = "h-4 w-4" }: { className?: string }) {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className={`${className} fill-none stroke-current`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.5" /><path d="M8.5 14.5c1 1.25 2.15 1.9 3.5 1.9s2.5-.65 3.5-1.9" /><path d="M9 9.5h.01M15 9.5h.01" /></svg>
}

export function DoubleDeliveryCheckIcon({ className = "h-3 w-4" }: { className?: string }) {
    return <svg viewBox="0 0 14 10" aria-hidden="true" className={`${className} shrink-0 fill-none stroke-current`} strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"><path d="m1 5 2.4 2.4L8.7 1.6" /><path d="m4.5 5 2.4 2.4 5.3-5.8" /></svg>
}

export function SingleDeliveryCheckIcon({ className = "h-3 w-4" }: { className?: string }) {
    return <svg viewBox="0 0 10 10" aria-hidden="true" className={`${className} shrink-0 fill-none stroke-current`} strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"><path d="m1 5 2.4 2.4L8.7 1.6" /></svg>
}
