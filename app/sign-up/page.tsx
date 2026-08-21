import Link from "next/link"
import { redirect } from "next/navigation"
import { AuthFieldFeedback } from "@/components/auth/AuthFieldFeedback"
import { AuthFlowShell, authPrimaryButton } from "@/components/auth/AuthFlowShell"
import { accountFlowV2Enabled, getOnboardingContext } from "@/lib/auth/account-flow"

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
    const enabled = accountFlowV2Enabled()
    const context = enabled ? await getOnboardingContext() : null
    if (context) redirect(`/sign-up/${context.currentStep}`)
    const { reason } = await searchParams
    const disabled = !enabled || reason === "disabled"
    return <AuthFlowShell showProgress={false} eyebrow="Invitation-only access" title={disabled ? "Account creation is temporarily paused" : "You’ll need an invitation"} description={disabled ? "Existing accounts can still sign in. New workspace accounts will resume once the upgraded flow is enabled." : "Betelgeze accounts are created from a workspace invitation so your email, role, and destination stay connected throughout setup."}>
        <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
            <AuthFieldFeedback tone={disabled ? "yellow" : reason ? "red" : "grey"} message={disabled ? "New account setup is currently disabled." : reason ? "That invitation is invalid, expired, accepted, or has been replaced." : "Open the newest Betelgeze invitation email to begin."} />
        </div>
        <Link href="/login" className={`${authPrimaryButton} mt-6`}>Log in to an existing account</Link>
        <p className="mt-5 text-center text-xs leading-5 text-neutral-500">Ask a workspace owner or administrator to send a fresh invitation if you need access.</p>
    </AuthFlowShell>
}
