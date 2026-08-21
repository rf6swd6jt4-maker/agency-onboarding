import { PasswordRecoveryFlow } from "@/components/auth/PasswordRecoveryFlow"

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
    const { email } = await searchParams
    return <PasswordRecoveryFlow step="request" initialEmail={email?.trim().toLowerCase() ?? ""} />
}
