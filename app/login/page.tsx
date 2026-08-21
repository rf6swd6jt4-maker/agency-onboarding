import { LegacyLogin } from "@/components/auth/LegacyLogin"
import { LoginV2 } from "@/components/auth/LoginV2"
import { accountFlowV2Enabled } from "@/lib/auth/account-flow"

export default function LoginPage() {
    return accountFlowV2Enabled() ? <LoginV2 /> : <LegacyLogin />
}
