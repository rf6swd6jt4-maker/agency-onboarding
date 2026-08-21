import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { PasswordRecoveryFlow } from "@/components/auth/PasswordRecoveryFlow"
import { RECOVERY_EMAIL_COOKIE, RECOVERY_VERIFIED_COOKIE } from "@/lib/auth/account-flow"

function maskedEmail(email: string) {
    const [local, domain] = email.split("@")
    if (!local || !domain) return "your email"
    const visible = local.slice(0, Math.min(2, local.length))
    return `${visible}${"•".repeat(Math.max(3, local.length - visible.length))}@${domain}`
}

export default async function PasswordRecoveryStepPage({ params }: { params: Promise<{ step: string }> }) {
    const { step } = await params
    if (!(["code", "new-password", "complete"] as const).includes(step as "code" | "new-password" | "complete")) redirect("/forgot-password")
    if (step === "complete") return <PasswordRecoveryFlow step="complete" />
    const encoded = (await cookies()).get(RECOVERY_EMAIL_COOKIE)?.value
    if (!encoded) redirect("/forgot-password")
    if (step === "new-password" && !(await cookies()).get(RECOVERY_VERIFIED_COOKIE)?.value) redirect("/forgot-password/code")
    let email = ""
    try { email = decodeURIComponent(encoded) } catch { redirect("/forgot-password") }
    return <PasswordRecoveryFlow step={step as "code" | "new-password"} maskedEmail={maskedEmail(email)} />
}
