import { redirect } from "next/navigation"

export default function LegacyAcceptInvitePage() {
    redirect("/sign-up?reason=legacy-invitation")
}
