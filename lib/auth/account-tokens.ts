import "server-only"

import { createHash, randomBytes } from "node:crypto"

export function hashAccountToken(value: string) {
    return createHash("sha256").update(value).digest("hex")
}

export function createAccountToken() {
    return randomBytes(32).toString("base64url")
}
