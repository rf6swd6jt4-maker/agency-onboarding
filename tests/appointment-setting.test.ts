import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
    appointmentSettingDetailHref,
    filterAppointmentSettingRelationships,
    formatUsPhone,
    normalizeAppointmentMediums,
    normalizeAppointmentRequestedFields,
} from "../lib/appointment-setting.ts"
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
        filterAppointmentSettingRelationships(
            relationships,
            new Set(["retention-allowed", "retention-archived", "fulfilment-allowed"]),
            new Set(["retention-allowed", "retention-unassigned", "retention-archived", "fulfilment-allowed"]),
        ).map((item) => item.id),
        ["retention-allowed"],
    )
    assert.deepEqual(
        filterAppointmentSettingRelationships(relationships, null, new Set(["retention-allowed"])).map((item) => item.id),
        ["retention-allowed"],
    )
})

test("Appointment Setting opens the relationship's dedicated appointment table", () => {
    const source = readFileSync("app/[workspaceSlug]/appointment-setting/page.tsx", "utf8")
    const detail = readFileSync("app/[workspaceSlug]/appointment-setting/[relationshipId]/page.tsx", "utf8")

    assert.match(source, /<List ariaLabel="Relationships ready for appointment setting">/)
    assert.match(source, /<RelationshipStage phase="retention"/)
    assert.match(source, /<Status label="Ready" tone="green"/)
    assert.match(source, /accessibleRelationshipIds\(access\)/)
    assert.match(source, /loadAppointmentSettingRelationshipServices\(access\)/)
    assert.equal(appointmentSettingDetailHref("acme", "relationship-1"), "/acme/appointment-setting/relationship-1")
    assert.match(detail, /<DetailPageHeader/)
    assert.match(detail, /<AppointmentTable/)
    assert.match(detail, /loadAppointmentSettingRelationshipService\(access, relationshipId\)/)
})

test("Appointment Setting appointments are relationship and service scoped with secure realtime reads", () => {
    const migration = readFileSync("supabase/migrations/20260903220000_appointment_setting_appointments.sql", "utf8")
    const actions = readFileSync("app/[workspaceSlug]/appointment-setting/[relationshipId]/actions.ts", "utf8")
    const table = readFileSync("components/appointment-setting/AppointmentTable.tsx", "utf8")

    assert.match(migration, /create table if not exists public\.appointment_setting_appointments/)
    assert.match(migration, /relationship_id uuid not null/)
    assert.match(migration, /service_id uuid not null/)
    assert.match(migration, /contact_name text not null/)
    assert.match(migration, /phone text not null/)
    assert.match(migration, /appointment_at timestamptz not null/)
    assert.match(migration, /workspace_user_can_manage_appointment_setting/)
    assert.match(migration, /capability\.capability = 'appointment_setting\.manage'/)
    assert.match(migration, /alter publication supabase_realtime add table public\.appointment_setting_appointments/)
    assert.match(actions, /requireWorkspacePanel\(workspaceSlug, "appointment-setting"\)/)
    assert.match(actions, /loadAppointmentSettingRelationshipService\(context\.access, relationshipId\)/)
    assert.match(table, /\.on\("postgres_changes"/)
    assert.match(table, /updateAppointmentSettingAppointment/)
})

test("Appointment Setting onboarding config drives table fields and remote links", () => {
    const migration = readFileSync("supabase/migrations/20260904090000_appointment_setting_onboarding_configuration.sql", "utf8")
    const table = readFileSync("components/appointment-setting/AppointmentTable.tsx", "utf8")
    const actions = readFileSync("app/[workspaceSlug]/appointment-setting/[relationshipId]/actions.ts", "utf8")

    assert.deepEqual(normalizeAppointmentMediums(["phone", "zoom", "invalid", "zoom"]), ["phone", "zoom"])
    assert.deepEqual(normalizeAppointmentRequestedFields([{ key: "email", required: true }, { key: "notes", required: false }]), [{ key: "email", required: true }, { key: "notes", required: false }])
    assert.equal(formatUsPhone("+1 214 555 0199"), "(214) 555-0199")
    assert.equal(formatUsPhone("123"), null)
    assert.match(migration, /relationship_appointment_setting_configs/)
    assert.match(migration, /appointment_medium_configured/)
    assert.match(migration, /appointment_fields_configured/)
    assert.match(migration, /meeting_medium = 'phone' or meeting_link is not null/)
    assert.match(table, /name="appointment_date" type="date"/)
    assert.match(table, /name="appointment_time" type="time"/)
    assert.match(table, /configuration\.fields\.map/)
    assert.match(actions, /formatUsPhone/)
    assert.match(actions, /Add a valid HTTPS meeting link/)
})
