# RosterLlama

Standalone multi-tenant SaaS for youth-program operators.

This private repository is the canonical source for RosterLlama development and staging.

## Safety
- Existing Afterschool University production systems remain separate and untouched.
- Operational records are organization-scoped.
- Registration/payment state changes must be server-authoritative.

## Run
```
npm install
npm start
```



### Pickup devices
Staff create a session-scoped pickup link from Attendance. Open it on a supervised tablet; the token is exchanged for an HttpOnly device cookie and removed from the address bar. Links expire after 12 hours and staff can revoke all devices. The screen shows only currently checked-in participants, validates the entered adult against the guardian/pickup list, and atomically records sign-out, checkout and an audit entry. Staff must verify identity before releasing a participant; typing a listed name is a permission check, not identity proof.

### Platform subscription billing
Set `STRIPE_SECRET_KEY`, `STRIPE_SUBSCRIPTION_PRICE_ID` (a recurring platform price), `STRIPE_WEBHOOK_SECRET`, and `PUBLIC_BASE_URL` (the HTTPS app origin; defaults to Railway's public domain). Configure the Stripe customer billing portal and deliver platform `checkout.session.completed` plus `customer.subscription.created`, `.updated`, and `.deleted` events to `/api/stripe/webhook`. Connect payment events continue to use the same endpoint and remain separated by connected account. Only owners can start checkout or open the portal. Subscription status comes from verified webhooks and a current Stripe subscription lookup, never from a success redirect. Plan pricing is configured in Stripe and is not invented by the application.

### Tests
`npm test` runs security and workflow integration tests against PostgreSQL. Use a disposable database; outside CI set `ALLOW_INTEGRATION_TESTS=true`. Subscription tests use a fake Stripe transport and never charge a card. Coverage includes pickup scope, private-data exclusion, concurrency, revocation, family waitlist acceptance, transfer ages, checkout reuse and out-of-order/idempotent webhook processing.
