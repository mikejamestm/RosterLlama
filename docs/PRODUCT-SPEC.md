# RosterLlama Product Spec

RosterLlama is a polished multi-tenant SaaS for youth-program business owners/operators. The product is about control, organization, automation, and reducing admin.

## Non-negotiables
- Every customer-facing and owner/staff page is intentionally designed, responsive, and branded.
- No stock/default framework, checkout, form, table, admin, or placeholder UI.
- One authoritative database and organization-scoped records.
- Atomic capacity/registration/payment state changes, idempotency, audit trail, explicit registration states.
- Existing Afterschool University production systems remain untouched until migration is intentionally approved.

## Product surfaces
- Self-service account creation and onboarding
- Organization/business profile and branding
- Owner dashboard
- Fully program-specific builder: each program can independently set type, website/category grouping, description, session name, calendar start/end dates, times, pricing, capacity, registration status, age eligibility, multiple-child behavior, waitlist behavior, add-ons such as Extended Care, and its own registration questions. Presets include birthday, booster-seat need, allergies/medical notes, emergency contacts, authorized pickups and waiver; operators can add custom required/optional questions with different input types.
- Hosted registration and website link/embed
- Households, multiple children, authorized pickups, allergies/medical notes, waivers/forms
- Registration lifecycle: draft/pending_payment/enrolled/waitlisted/cancelled/refunded/transferred/removed. Staff can remove a participant from a session with confirmation/reason and capacity immediately increases; staff can transfer a registration to another eligible open session with capacity atomically moving between sessions.
- Stripe Connect for operator merchant accounts and RosterLlama subscription billing
- Live rosters
- Staff users/roles and staff-optimized views
- Attendance/check-in
- Pickup/sign-out, authorized pickup verification, initials and late sign-out
- Absence reporting
- Waitlists with ordered queue, no payment while waiting, configurable 24-hour reserved offers, automatic/manual promotion and offer expiry
- Server-enforced age eligibility: operators can leave ages unrestricted, set a minimum only, maximum only, or an exact/range (for example min 3 + max 3 means only age 3 can register). Ineligible children cannot complete registration or bypass the rule client-side.\n- Capacity shared by registration, payment, transfers, cancellations and waitlist offers
- Session communications: staff can select one or multiple sessions, generate a deduplicated list of enrolled family emails, copy recipients, draft a subject/message, or hand the draft to their device email client with recipients placed in BCC. Future connected-email sending must be explicit and auditable.\n- Reports/exports and audit history
- Health checker for impossible states

## UX
- Desktop owner workspace plus excellent tablet/mobile staff experiences.
- Parent registration/pickup flows are simple and fast, but brand positioning is operator-first.
- Locked RosterLlama logo asset must be used exactly; do not redraw it.
