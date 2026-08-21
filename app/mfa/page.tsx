"use client"

import { Suspense, useCallback } from "react"
import { useSearchParams } from "next/navigation"
import { AuthFlowShell } from "@/components/auth/AuthFlowShell"
import { MfaGuide } from "@/components/auth/MfaGuide"
import { resolveClientDestination } from "@/lib/auth/redirects"

function MfaScreen() {
    const searchParams = useSearchParams()
    const requestedNext = searchParams.get("next")
    const onVerified = useCallback(() => window.location.assign(resolveClientDestination(requestedNext)), [requestedNext])
    return <AuthFlowShell showProgress={false} eyebrow="Account security" title="Confirm your identity" description="Enter your authenticator code to finish signing in. If this is your first visit, we’ll guide you through setup."><MfaGuide onVerified={onVerified} setupLabel="Betelgeze primary" /></AuthFlowShell>
}

export default function MfaPage() {
    return <Suspense fallback={null}><MfaScreen /></Suspense>
}
