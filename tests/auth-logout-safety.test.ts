import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const logoutRoute = readFileSync("app/logout/route.ts", "utf8")
const profilePage = readFileSync("app/users/[username]/page.tsx", "utf8")
const accountMenu = readFileSync("components/account/AccountMenu.tsx", "utf8")

test("logout is POST-only and cannot be triggered by Next.js link prefetch", () => {
    assert.match(logoutRoute, /export async function POST/)
    assert.match(logoutRoute, /export function GET/)
    assert.match(logoutRoute, /NextResponse\.redirect\([^\n]+, 303\)/)
    assert.equal((logoutRoute.match(/auth\.signOut/g) ?? []).length, 1)
    assert.doesNotMatch(profilePage, /<Link href="\/logout"/)
    assert.doesNotMatch(accountMenu, /<Link href="\/logout"/)
    assert.match(profilePage, /<form action="\/logout" method="post">/)
    assert.match(accountMenu, /<form action="\/logout" method="post">/)
})
