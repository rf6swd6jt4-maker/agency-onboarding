import assert from "node:assert/strict"
import test from "node:test"
import { stripeAccountMode } from "../lib/stripe/mode.ts"

test("manual Stripe credentials determine live and test mode from their key prefix", () => {
    assert.equal(stripeAccountMode({ credential: "sk_live_example" }), "live")
    assert.equal(stripeAccountMode({ credential: "rk_live_example" }), "live")
    assert.equal(stripeAccountMode({ credential: "sk_test_example" }), "test")
    assert.equal(stripeAccountMode({ credential: "rk_test_example" }), "test")
})

test("OAuth livemode metadata remains authoritative", () => {
    assert.equal(stripeAccountMode({ credential: "sk_test_example", configuredLivemode: "true" }), "live")
    assert.equal(stripeAccountMode({ credential: "sk_live_example", configuredLivemode: "false" }), "test")
})

test("an absent Account livemode value no longer silently becomes test mode", () => {
    assert.throws(() => stripeAccountMode({ credential: "unknown" }), /could not determine/u)
    assert.equal(stripeAccountMode({ credential: "unknown", accountLivemode: true }), "live")
    assert.equal(stripeAccountMode({ credential: "unknown", accountLivemode: false }), "test")
})
