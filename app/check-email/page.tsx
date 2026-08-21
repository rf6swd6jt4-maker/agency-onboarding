import { redirect } from "next/navigation"

export default function LegacyCheckEmailPage() {
    redirect("/sign-up/verify-email")
}
