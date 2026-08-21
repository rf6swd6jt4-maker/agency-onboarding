import { redirect } from "next/navigation"
import { AccountOnboardingFlow } from "@/components/auth/AccountOnboardingFlow"
import { accountFlowV2Enabled, authStepIndex, getOnboardingContext, isAuthStep } from "@/lib/auth/account-flow"

export default async function AccountOnboardingStepPage({ params }: { params: Promise<{ step: string }> }) {
    if (!accountFlowV2Enabled()) redirect("/sign-up?reason=disabled")
    const { step } = await params
    if (!isAuthStep(step)) redirect("/sign-up")
    const context = await getOnboardingContext()
    if (!context) redirect("/sign-up?reason=session")
    if (authStepIndex(step) > authStepIndex(context.currentStep)) redirect(`/sign-up/${context.currentStep}`)
    return <AccountOnboardingFlow context={context} step={step} />
}
