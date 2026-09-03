import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { filterAppointmentSettingRelationships } from "../lib/appointment-setting.ts"
import type { RelationshipRecord } from "../lib/relationships.ts"

function relationship(id: string, lifecyclePhase: RelationshipRecord["lifecycle_phase"], status: RelationshipRecord["status"] = "active") {
    return { id, lifecycle_phase: lifecyclePhase, status } as RelationshipRecord
}

test("Appointment Setting includes only visible, non-archived Retention relationships", () => {
    const relationships = [
        relationship("retention-allowed", "retention"),
        relationship("retention-unassigned", "retention"),
        relationship("retention-archived", "retention", "archived"),
        relationship("fulfilment-allowed", "fulfilment"),
    ]

    assert.deepEqual(
        filterAppointmentSettingRelationships(relationships, new Set(["retention-allowed", "retention-archived", "fulfilment-allowed"])).map((item) => item.id),
        ["retention-allowed"],
    )
    assert.deepEqual(
        filterAppointmentSettingRelationships(relationships, null).map((item) => item.id),
        ["retention-allowed", "retention-unassigned"],
    )
})

test("Appointment Setting uses the shared list and keeps unfinished detail routes out of the UI", () => {
    const source = readFileSync("app/[workspaceSlug]/appointment-setting/page.tsx", "utf8")

    assert.match(source, /<List ariaLabel="Relationships ready for appointment setting">/)
    assert.match(source, /<RelationshipStage phase="retention"/)
    assert.match(source, /<Status label="Ready" tone="green"/)
    assert.match(source, /accessibleRelationshipIds\(access\)/)
    assert.doesNotMatch(source, /appointment-setting\/\$\{relationship\.id\}/)
})
