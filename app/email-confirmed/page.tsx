import { redirect } from "next/navigation"

export default function LegacyConfirmedPage() {
    redirect("/login")
}
