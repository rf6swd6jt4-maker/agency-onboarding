import { Status, type StatusTone } from "@/components/ui"

export function AuthFieldFeedback({ message, tone = "grey", id }: { message: string; tone?: StatusTone; id?: string }) {
    return (
        <div id={id} className="mt-2 min-h-5" aria-live={tone === "red" ? "assertive" : "polite"}>
            <Status label={message} tone={tone} wrap className="max-w-full text-xs leading-5" />
        </div>
    )
}
