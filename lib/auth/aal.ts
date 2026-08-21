import "server-only"

import type { SupabaseClient, User } from "@supabase/supabase-js"
import { redirectToLogin, redirectToMfa } from "@/lib/auth/server-redirects"
import { getVerifiedUser } from "@/lib/auth/verified-user"
import { supabaseAdmin } from "@/lib/supabase/admin"

async function requiresMfaReenrollment(userId: string) {
    const { data, error } = await supabaseAdmin.from("user_profiles").select("mfa_reenrollment_required").eq("user_id", userId).maybeSingle()
    return Boolean(error || data?.mfa_reenrollment_required)
}

export async function getAal2User(supabase: SupabaseClient): Promise<User | null> {
    const user = await getVerifiedUser(supabase)
    if (!user) return null
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (error || data.currentLevel !== "aal2" || await requiresMfaReenrollment(user.id)) return null
    return user
}

export async function requireAuthenticatedUser(supabase: SupabaseClient): Promise<User> {
    const user = await getVerifiedUser(supabase)
    if (!user) return await redirectToLogin()
    return user
}

export async function requireAal2User(supabase: SupabaseClient): Promise<User> {
    const user = await requireAuthenticatedUser(supabase)
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (error || data.currentLevel !== "aal2" || await requiresMfaReenrollment(user.id)) return await redirectToMfa()
    return user
}
