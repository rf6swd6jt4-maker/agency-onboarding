# Service-scoped Staff access

Staff remains one workspace role. A Staff member's usable product surfaces are the union of the capabilities granted by their assigned services. Owner and Admin continue to have full access to the workspace's available product surfaces.

## Capability rules

- Every service grants `onboarding.manage` and `fulfilment.manage`.
- The Appointment Setting template also grants `appointment_setting.manage`.
- Appointment Setting is a service-activated product surface: it is absent for everyone until the workspace creates a template-derived Appointment Setting service. A non-archived service activates it for Owner and Admin; Staff must be assigned that service and retain its capability.
- Assigning multiple services combines their capabilities; it does not create another role.
- Staff without an assigned service have no product panel and land on the no-access screen.
- Settings, Admin, Relationships, Communications, Library, Builder, and Lead Gen remain Owner/Admin-only until a deliberate service capability is introduced for one of them.

## Record scope

- A Staff member can work with a relationship when at least one of its services is assigned to them.
- Service-owned onboarding modules, steps, work items, and linked assets require that exact service assignment.
- Mandatory onboarding bookends are shared across the assigned relationship.
- Legacy or relationship-wide records are available only when the Staff member covers every service on that relationship. Sensitive legacy, billing, communications, integration, and client-portal records remain Owner/Admin-only.
- Server route guards and database row-level policies enforce the same rules. Hiding navigation is not treated as authorization.

## Administration

- A Staff invitation must include at least one Active service.
- Invitation service assignments are copied to the membership when the invitation is accepted.
- Owner and Admin can change a Staff member's service assignments. Only Owner can promote or demote Admin users.
- Existing Staff members receive all existing services during migration so the rollout does not silently remove their current operational access; administrators can then narrow those assignments in Settings.

## Rollout and acceptance checks

Apply `supabase/migrations/20260902170000_service_scoped_staff_access.sql` before deploying the application revision that consumes the new tables and RPCs.

For acceptance, verify a workspace without Appointment Setting hides the panel and rejects its direct URL for every role; creating the template service exposes it to Owner and Admin; a new Staff account assigned only Meta Ads sees Onboarding and Fulfilment; assigning the Appointment Setting service also exposes Appointment Setting; combining services produces the union; and unassigned records and direct panel URLs return no data or a not-found response.
