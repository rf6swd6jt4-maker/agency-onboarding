import { redirect } from "next/navigation"

export default function LegacyUpdatePasswordPage() {
    redirect("/forgot-password/new-password")
}
