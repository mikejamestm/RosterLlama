-- RosterLlama PostgreSQL production foundation
CREATE TABLE IF NOT EXISTS organizations(id text PRIMARY KEY,name text NOT NULL,slug text UNIQUE NOT NULL,stripe_account_id text,payments_status text NOT NULL DEFAULT 'not_connected',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS families(id text PRIMARY KEY,organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,name text,email text NOT NULL,phone text,password_hash text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,email));
CREATE TABLE IF NOT EXISTS participants(id text PRIMARY KEY,family_id text NOT NULL REFERENCES families(id) ON DELETE CASCADE,name text NOT NULL,birth_date date,allergies text,emergency_contact text,authorized_pickups jsonb NOT NULL DEFAULT '[]'::jsonb,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS programs(id text PRIMARY KEY,organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,name text NOT NULL,price integer NOT NULL DEFAULT 0,questions jsonb NOT NULL DEFAULT '[]'::jsonb,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sessions(id text PRIMARY KEY,program_id text NOT NULL REFERENCES programs(id) ON DELETE CASCADE,label text NOT NULL,capacity integer NOT NULL CHECK(capacity>=0),status text NOT NULL DEFAULT 'open',starts_at timestamptz,ends_at timestamptz,price integer,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS registrations(id text PRIMARY KEY,organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,session_id text NOT NULL REFERENCES sessions(id),participant_id text NOT NULL REFERENCES participants(id),status text NOT NULL,payment_status text NOT NULL DEFAULT 'pending',waitlist_id text,created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS one_active_registration ON registrations(session_id,participant_id) WHERE status='enrolled';
CREATE TABLE IF NOT EXISTS waitlist(id text PRIMARY KEY,organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,session_id text NOT NULL REFERENCES sessions(id),participant_id text NOT NULL REFERENCES participants(id),status text NOT NULL DEFAULT 'waiting',offer_expires_at timestamptz,accepted_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS payments(id text PRIMARY KEY,organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,registration_id text NOT NULL REFERENCES registrations(id),amount integer NOT NULL CHECK(amount>=0),status text NOT NULL,processor_id text UNIQUE,idempotency_key text UNIQUE,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS refunds(id text PRIMARY KEY,organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,registration_id text NOT NULL REFERENCES registrations(id),payment_id text REFERENCES payments(id),amount integer NOT NULL CHECK(amount>0),status text NOT NULL,reason text,note text,processor_id text UNIQUE,idempotency_key text UNIQUE,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS audit_log(id text PRIMARY KEY,organization_id text REFERENCES organizations(id) ON DELETE CASCADE,actor_type text,actor_id text,action text NOT NULL,detail jsonb,created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS data_migrations(id text PRIMARY KEY,completed_at timestamptz NOT NULL DEFAULT now(),detail jsonb);

CREATE TABLE IF NOT EXISTS owners(id text PRIMARY KEY,organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,email text NOT NULL,password_hash text NOT NULL,name text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,email));
CREATE TABLE IF NOT EXISTS staff(id text PRIMARY KEY,organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,email text NOT NULL,password_hash text,name text,role text NOT NULL DEFAULT 'staff',status text NOT NULL DEFAULT 'invited',created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,email));
CREATE TABLE IF NOT EXISTS absences(id text PRIMARY KEY,organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,participant_id text NOT NULL REFERENCES participants(id),absence_date date NOT NULL,reason text,reported_by text,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS attendance(id text PRIMARY KEY,organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,session_id text REFERENCES sessions(id),participant_id text NOT NULL REFERENCES participants(id),action text NOT NULL,at timestamptz NOT NULL DEFAULT now(),actor_id text);
CREATE TABLE IF NOT EXISTS signouts(id text PRIMARY KEY,organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,session_id text REFERENCES sessions(id),participant_id text NOT NULL REFERENCES participants(id),pickup_name text NOT NULL,initials text NOT NULL,authorized boolean,override_reason text,late boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS registration_requests(id text PRIMARY KEY,organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,registration_id text NOT NULL REFERENCES registrations(id),request_type text NOT NULL,target_session_id text REFERENCES sessions(id),reason text,status text NOT NULL DEFAULT 'pending',resolved_by text,created_at timestamptz NOT NULL DEFAULT now(),resolved_at timestamptz);
CREATE TABLE IF NOT EXISTS payouts(id text PRIMARY KEY,organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,amount integer NOT NULL,status text NOT NULL,arrival_date date,destination text,processor_id text UNIQUE,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS disputes(id text PRIMARY KEY,organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,payment_id text REFERENCES payments(id),amount integer NOT NULL,status text NOT NULL,reason text,evidence_due_at timestamptz,processor_id text UNIQUE,created_at timestamptz NOT NULL DEFAULT now());

ALTER TABLE signouts ADD COLUMN IF NOT EXISTS service_date date NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE absences ADD COLUMN IF NOT EXISTS session_id text REFERENCES sessions(id);
CREATE UNIQUE INDEX IF NOT EXISTS one_signout_per_participant_session_day ON signouts(participant_id,session_id,service_date);
DROP INDEX IF EXISTS one_absence_per_participant_day;
CREATE UNIQUE INDEX IF NOT EXISTS one_absence_per_participant_session_day ON absences(participant_id,session_id,absence_date) WHERE session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS one_general_absence_per_participant_day ON absences(participant_id,absence_date) WHERE session_id IS NULL;

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS business_type text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS website text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS branding_complete boolean NOT NULL DEFAULT false;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_status text;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS age text;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS allow_multiple_children boolean NOT NULL DEFAULT true;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS addons jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS waitlist_mode text NOT NULL DEFAULT 'automatic';
ALTER TABLE programs ADD COLUMN IF NOT EXISTS age_min integer;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS age_max integer;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS start_date text;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS end_date text;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS start_time text;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS end_time text;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS answers jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS removal_reason text;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS removed_at timestamptz;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS transferred_from text;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS transferred_at timestamptz;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS answers jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS one_pending_registration_request ON registration_requests(registration_id) WHERE status='pending';

CREATE TABLE IF NOT EXISTS family_activation_tokens(token_hash text PRIMARY KEY,family_id text NOT NULL REFERENCES families(id) ON DELETE CASCADE,organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,expires_at timestamptz NOT NULL,used_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS family_activation_tokens_family ON family_activation_tokens(family_id,expires_at);

ALTER TABLE registrations ADD COLUMN IF NOT EXISTS addons jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS amount_due integer;

ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS addons jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS amount_due integer;

CREATE TABLE IF NOT EXISTS staff_activation_tokens(token_hash text PRIMARY KEY,staff_id text NOT NULL REFERENCES staff(id) ON DELETE CASCADE,organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,expires_at timestamptz NOT NULL,used_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS staff_activation_tokens_staff ON staff_activation_tokens(staff_id,expires_at);


ALTER TABLE payments ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'usd';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_intent_id text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS charge_id text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS fee integer NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS payments_payment_intent_unique ON payments(payment_intent_id) WHERE payment_intent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payments_charge_unique ON payments(charge_id) WHERE charge_id IS NOT NULL;

ALTER TABLE refunds ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'usd';

ALTER TABLE payouts ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'usd';
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS fee integer NOT NULL DEFAULT 0;
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS failure_message text;
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS arrival_at timestamptz;

ALTER TABLE disputes ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'usd';
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS payment_intent_id text;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS charge_id text;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS outcome text;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS disputes_processor_unique ON disputes(processor_id) WHERE processor_id IS NOT NULL;

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS contact_email text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS contact_phone text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS logo_url text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS primary_color text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS waiver_title text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS waiver_text text;

ALTER TABLE registrations ADD COLUMN IF NOT EXISTS waiver_title text;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS waiver_text text;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS waiver_accepted_at timestamptz;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS waiver_title text;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS waiver_text text;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS waiver_accepted_at timestamptz;

ALTER TABLE disputes ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS evidence_submitted_at timestamptz;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS internal_note text;

CREATE TABLE IF NOT EXISTS communications(
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_type text NOT NULL,
  actor_id text,
  session_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  recipient_count integer NOT NULL DEFAULT 0 CHECK(recipient_count>=0),
  delivery_method text NOT NULL DEFAULT 'mailto',
  status text NOT NULL DEFAULT 'handed_off',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS communications_org_created ON communications(organization_id,created_at DESC);

CREATE INDEX IF NOT EXISTS absences_session_date ON absences(session_id,absence_date);

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Los_Angeles';
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS service_date date;
CREATE INDEX IF NOT EXISTS attendance_session_service_date ON attendance(session_id,service_date);

CREATE UNIQUE INDEX IF NOT EXISTS one_attendance_action_per_session_day ON attendance(participant_id,session_id,service_date,action) WHERE service_date IS NOT NULL;


CREATE TABLE IF NOT EXISTS pickup_devices (
  id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token_hash text UNIQUE NOT NULL, session_ids text[] NOT NULL, expires_at timestamptz NOT NULL,
  revoked_at timestamptz, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pickup_devices_org ON pickup_devices(organization_id);
CREATE TABLE IF NOT EXISTS platform_billing (
  organization_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id text UNIQUE, subscription_id text UNIQUE, checkout_id text,
  status text NOT NULL DEFAULT 'not_started', cancel_at_period_end boolean NOT NULL DEFAULT false,
  current_period_end timestamptz, last_event_created bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS platform_billing_events (
  event_id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type text NOT NULL, received_at timestamptz NOT NULL DEFAULT now()
);
