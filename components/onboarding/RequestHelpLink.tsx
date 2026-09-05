"use client"

import type { MouseEvent } from "react"

export function RequestHelpLink() {
    function showHelp(event: MouseEvent<HTMLAnchorElement>) {
        event.preventDefault()
        const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-onboarding-help-card]"))
        const card = cards.find((candidate) => candidate.offsetParent !== null) ?? cards[0]
        if (!card) return
        card.scrollIntoView({ behavior: "smooth", block: "center" })
        card.querySelector<HTMLElement>("a, button")?.focus({ preventScroll: true })
    }

    return <a href="#onboarding-help-inline" onClick={showHelp} className="font-medium underline decoration-red-300 underline-offset-2 hover:text-red-900">Request help</a>
}
