-- Arka schema v1.
-- Rules of the house:
--   * money is integer paise (bigint), quantities numeric(12,3), time timestamptz, dates date
--   * every business table carries company_id, isolated by row-level security (fail closed)
--   * cross-table references are composite (company_id, id) so a guessed id from another workspace can't be linked
--   * invariants live in CHECK / UNIQUE / EXCLUDE constraints, not only in code

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Tenancy helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_company() RETURNS bigint LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.company_id', true), '')::bigint $$;

CREATE OR REPLACE FUNCTION app_bypass() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT coalesce(current_setting('app.bypass', true), '') = 'on' $$;

-- ---------------------------------------------------------------------------
-- Workspaces and people
-- ---------------------------------------------------------------------------
CREATE TABLE companies (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name                     text NOT NULL CHECK (length(name) BETWEEN 2 AND 100),
  kind                     text NOT NULL DEFAULT 'real' CHECK (kind IN ('real', 'demo', 'template')),
  demo_expires_at          timestamptz,
  timezone                 text NOT NULL DEFAULT 'Asia/Kolkata',
  phone                    text,
  email                    text,
  address                  text,
  gstin                    text,
  advance_percent          integer NOT NULL DEFAULT 30 CHECK (advance_percent BETWEEN 0 AND 100),
  labour_rate_paise        bigint NOT NULL DEFAULT 60000 CHECK (labour_rate_paise >= 0),
  sla_first_call_minutes   integer NOT NULL DEFAULT 120 CHECK (sla_first_call_minutes BETWEEN 15 AND 2880),
  quote_validity_days      integer NOT NULL DEFAULT 15 CHECK (quote_validity_days BETWEEN 1 AND 90),
  subsidy_enabled          boolean NOT NULL DEFAULT true,
  subsidy_slab1_kw         numeric(4,1) NOT NULL DEFAULT 2,
  subsidy_slab1_per_kw_paise bigint NOT NULL DEFAULT 3000000,
  subsidy_slab2_kw         numeric(4,1) NOT NULL DEFAULT 3,
  subsidy_slab2_per_kw_paise bigint NOT NULL DEFAULT 1800000,
  subsidy_cap_paise        bigint NOT NULL DEFAULT 7800000,
  -- public, unguessable key for the website enquiry form (/enquire/<key>)
  public_key               text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  created_at               timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'demo') = (demo_expires_at IS NOT NULL))
);

CREATE TABLE users (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id         bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  name               text NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  email              text NOT NULL CHECK (email = lower(email) AND position('@' IN email) > 1),
  phone              text,
  role               text NOT NULL CHECK (role IN ('owner', 'sales', 'technician', 'warehouse', 'support', 'accounts')),
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'disabled')),
  hourly_cost_paise  bigint NOT NULL DEFAULT 0 CHECK (hourly_cost_paise >= 0),
  password_hash      text,
  email_verified_at  timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  CHECK (status = 'invited' OR password_hash IS NOT NULL)
);
-- A person (email) is unique across all workspaces.
CREATE UNIQUE INDEX users_email_uq ON users (email);
CREATE INDEX users_company_role_idx ON users (company_id, role) WHERE status = 'active';

CREATE TABLE sessions (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id    bigint NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  user_id       bigint NOT NULL,
  token_hash    bytea NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  user_agent    text,
  ip            text,
  FOREIGN KEY (company_id, user_id) REFERENCES users (company_id, id) ON DELETE CASCADE
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

-- One-time codes and links (email verification, password reset, invitations). Only HMACs are stored.
CREATE TABLE auth_codes (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  bigint NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  user_id     bigint NOT NULL,
  purpose     text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password', 'invite')),
  code_hash   text,
  link_hash   text,
  attempts    integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, user_id) REFERENCES users (company_id, id) ON DELETE CASCADE,
  CHECK (code_hash IS NOT NULL OR link_hash IS NOT NULL)
);
CREATE INDEX auth_codes_user_idx ON auth_codes (user_id, purpose, created_at DESC);
CREATE UNIQUE INDEX auth_codes_link_uq ON auth_codes (link_hash) WHERE link_hash IS NOT NULL;

-- Server-generated secrets (e.g. the HMAC key) so no human ever handles them.
CREATE TABLE app_secrets (
  name        text PRIMARY KEY,
  value       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Per-workspace counters for human references (ENQ-0001, INV/26-27/0001 …).
CREATE TABLE sequences (
  company_id  bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  key         text NOT NULL,
  last_value  integer NOT NULL CHECK (last_value > 0),
  PRIMARY KEY (company_id, key)
);

-- ---------------------------------------------------------------------------
-- Customers and enquiries
-- ---------------------------------------------------------------------------
CREATE TABLE customers (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id    bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  phone         text NOT NULL CHECK (phone ~ '^\+91[6-9][0-9]{9}$'),
  email         text,
  address       text NOT NULL,
  city          text NOT NULL,
  pincode       text NOT NULL CHECK (pincode ~ '^[1-9][0-9]{5}$'),
  kind          text NOT NULL DEFAULT 'home' CHECK (kind IN ('home', 'business')),
  portal_token  text NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, phone)
);
CREATE INDEX customers_name_trgm ON customers USING gin (name gin_trgm_ops);
CREATE INDEX customers_phone_trgm ON customers USING gin (phone gin_trgm_ops);

CREATE TABLE leads (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id          bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  ref                 text NOT NULL,
  customer_id         bigint NOT NULL,
  source              text NOT NULL CHECK (source IN ('web_form', 'whatsapp', 'call', 'walk_in', 'referral')),
  status              text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'survey', 'quoted', 'won', 'lost')),
  system_type         text NOT NULL DEFAULT 'not_sure' CHECK (system_type IN ('on_grid', 'off_grid', 'not_sure')),
  requested_kw        numeric(5,1) CHECK (requested_kw IS NULL OR requested_kw BETWEEN 0.5 AND 100),
  wants_subsidy       boolean NOT NULL DEFAULT false,
  message             text,
  assigned_to         bigint,
  first_contact_at    timestamptz,
  -- qualification call
  roof_area_sqft      integer CHECK (roof_area_sqft IS NULL OR roof_area_sqft BETWEEN 20 AND 50000),
  monthly_bill_paise  bigint CHECK (monthly_bill_paise IS NULL OR monthly_bill_paise > 0),
  grid_connection     text CHECK (grid_connection IN ('single_phase', 'three_phase', 'none')),
  sanctioned_load_kw  numeric(6,1),
  grid_suitable       boolean,
  roof_type           text CHECK (roof_type IN ('rcc', 'metal_sheet', 'tiled', 'other')),
  shading             text CHECK (shading IN ('none', 'partial', 'heavy')),
  recommended_kw      numeric(4,1),
  qualified_at        timestamptz,
  qualified_by        bigint,
  -- closing
  lost_reason         text,
  lost_note           text,
  closed_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, ref),
  FOREIGN KEY (company_id, customer_id) REFERENCES customers (company_id, id),
  FOREIGN KEY (company_id, assigned_to) REFERENCES users (company_id, id) ON DELETE SET NULL (assigned_to),
  FOREIGN KEY (company_id, qualified_by) REFERENCES users (company_id, id) ON DELETE SET NULL (qualified_by),
  -- an enquiry never vanishes: closing it needs a reason
  CHECK ((status = 'lost') = (lost_reason IS NOT NULL)),
  CHECK (status NOT IN ('qualified', 'survey', 'quoted', 'won') OR qualified_at IS NOT NULL)
);
CREATE INDEX leads_status_idx ON leads (company_id, status, created_at DESC);
CREATE INDEX leads_customer_idx ON leads (company_id, customer_id);
CREATE INDEX leads_assigned_idx ON leads (company_id, assigned_to) WHERE status NOT IN ('won', 'lost');

-- Uploaded images (site photos, signatures). Stored in the database so they survive redeploys.
CREATE TABLE files (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (purpose IN ('survey_photo', 'install_photo', 'signature', 'ticket_photo')),
  mime        text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  bytes       bytea NOT NULL,
  size        integer NOT NULL CHECK (size BETWEEN 1 AND 3145728),
  sha256      text NOT NULL,
  created_by  bigint,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id)
);

-- ---------------------------------------------------------------------------
-- Schedule: one board for surveys, installations and service visits
-- ---------------------------------------------------------------------------
CREATE TABLE visits (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id   bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('survey', 'installation', 'service')),
  customer_id  bigint NOT NULL,
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  status       text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'done', 'cancelled')),
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, customer_id) REFERENCES customers (company_id, id),
  CHECK (ends_at > starts_at AND ends_at - starts_at <= interval '14 hours')
);
CREATE INDEX visits_time_idx ON visits (company_id, starts_at);

-- Crew on each visit. The database refuses to book a technician in two places at once.
CREATE TABLE visit_crew (
  company_id     bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  visit_id       bigint NOT NULL,
  technician_id  bigint NOT NULL,
  period         tstzrange NOT NULL,
  active         boolean NOT NULL DEFAULT true,
  PRIMARY KEY (visit_id, technician_id),
  FOREIGN KEY (company_id, visit_id) REFERENCES visits (company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, technician_id) REFERENCES users (company_id, id),
  CONSTRAINT visit_crew_no_double_booking EXCLUDE USING gist (company_id WITH =, technician_id WITH =, period WITH &&) WHERE (active)
);
CREATE INDEX visit_crew_tech_idx ON visit_crew (company_id, technician_id);

-- ---------------------------------------------------------------------------
-- Surveys
-- ---------------------------------------------------------------------------
CREATE TABLE surveys (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id         bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  ref                text NOT NULL,
  lead_id            bigint NOT NULL,
  customer_id        bigint NOT NULL,
  technician_id      bigint NOT NULL,
  visit_id           bigint,
  status             text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'submitted', 'approved', 'rejected', 'cancelled')),
  azimuth_deg        integer CHECK (azimuth_deg BETWEEN 0 AND 359),
  tilt_deg           numeric(4,1) CHECK (tilt_deg BETWEEN 0 AND 60),
  usable_area_sqft   integer CHECK (usable_area_sqft BETWEEN 20 AND 50000),
  cable_distance_m   numeric(5,1) CHECK (cable_distance_m BETWEEN 1 AND 200),
  structure_type     text CHECK (structure_type IN ('flush', 'elevated_low', 'elevated_high')),
  roof_type          text CHECK (roof_type IN ('rcc', 'metal_sheet', 'tiled', 'other')),
  shading            text CHECK (shading IN ('none', 'partial', 'heavy')),
  earthing_possible  boolean,
  recommended_kw     numeric(4,1) CHECK (recommended_kw IS NULL OR recommended_kw BETWEEN 1 AND 5),
  shading_notes      text,
  notes              text,
  submitted_at       timestamptz,
  submitted_by       bigint,
  reviewed_at        timestamptz,
  reviewed_by        bigint,
  review_note        text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, ref),
  FOREIGN KEY (company_id, lead_id) REFERENCES leads (company_id, id),
  FOREIGN KEY (company_id, customer_id) REFERENCES customers (company_id, id),
  FOREIGN KEY (company_id, technician_id) REFERENCES users (company_id, id),
  FOREIGN KEY (company_id, visit_id) REFERENCES visits (company_id, id) ON DELETE SET NULL (visit_id),
  -- a submitted survey has every measurement the brief asks for
  CHECK (status IN ('scheduled', 'cancelled') OR (azimuth_deg IS NOT NULL AND tilt_deg IS NOT NULL AND cable_distance_m IS NOT NULL
         AND usable_area_sqft IS NOT NULL AND recommended_kw IS NOT NULL AND submitted_at IS NOT NULL)),
  CHECK (status NOT IN ('approved', 'rejected') OR reviewed_at IS NOT NULL),
  CHECK (status <> 'rejected' OR review_note IS NOT NULL)
);
CREATE INDEX surveys_lead_idx ON surveys (company_id, lead_id);
CREATE INDEX surveys_status_idx ON surveys (company_id, status);

CREATE TABLE survey_photos (
  company_id  bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  survey_id   bigint NOT NULL,
  file_id     bigint NOT NULL,
  PRIMARY KEY (survey_id, file_id),
  FOREIGN KEY (company_id, survey_id) REFERENCES surveys (company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, file_id) REFERENCES files (company_id, id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Catalogue, kits and stock
-- ---------------------------------------------------------------------------
CREATE TABLE products (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id        bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  sku               text NOT NULL CHECK (sku = upper(sku)),
  name              text NOT NULL,
  category          text NOT NULL CHECK (category IN ('panel', 'inverter', 'battery', 'charge_controller', 'structure', 'cable', 'wiring_box',
                                                      'switchgear', 'earthing', 'connector', 'accessory', 'service')),
  tracking          text NOT NULL CHECK (tracking IN ('serial', 'quantity', 'none')),
  uom               text NOT NULL DEFAULT 'unit' CHECK (uom IN ('unit', 'm', 'set', 'kit', 'job')),
  unit_cost_paise   bigint NOT NULL DEFAULT 0 CHECK (unit_cost_paise >= 0),
  sale_price_paise  bigint NOT NULL DEFAULT 0 CHECK (sale_price_paise >= 0),
  gst_rate_bp       integer NOT NULL DEFAULT 500 CHECK (gst_rate_bp IN (0, 500, 1200, 1800, 2800)),
  warranty_months   integer CHECK (warranty_months BETWEEN 1 AND 360),
  capacity_w        integer CHECK (capacity_w > 0),
  hsn               text,
  reorder_level     numeric(12,3) NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  on_hand           numeric(12,3) NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, sku),
  CHECK (tracking <> 'serial' OR (warranty_months IS NOT NULL AND uom = 'unit')),
  CHECK ((category = 'service') = (tracking = 'none')),
  CHECK (tracking <> 'none' OR on_hand = 0)
);
CREATE INDEX products_category_idx ON products (company_id, category) WHERE status = 'active';

CREATE TABLE kit_templates (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id   bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  code         text NOT NULL,
  name         text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('on_grid', 'off_grid', 'panel_set', 'service')),
  capacity_kw  numeric(4,1),
  description  text,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, code),
  CHECK (kind NOT IN ('on_grid', 'off_grid') OR capacity_kw BETWEEN 1 AND 5)
);

CREATE TABLE kit_template_lines (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id   bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  template_id  bigint NOT NULL,
  product_id   bigint NOT NULL,
  qty_rule     text NOT NULL CHECK (qty_rule IN ('fixed', 'per_kw', 'per_panel', 'cable_run')),
  qty          numeric(12,3) NOT NULL CHECK (qty > 0),
  sort         integer NOT NULL DEFAULT 0,
  FOREIGN KEY (company_id, template_id) REFERENCES kit_templates (company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, product_id) REFERENCES products (company_id, id)
);
CREATE INDEX kit_lines_template_idx ON kit_template_lines (company_id, template_id, sort);

CREATE TABLE suppliers (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id)
);
CREATE UNIQUE INDEX suppliers_name_uq ON suppliers (company_id, lower(name));

-- Stock purchases (goods received). Serial numbers are captured here.
CREATE TABLE purchases (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id        bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  ref               text NOT NULL,
  supplier_id       bigint NOT NULL,
  supplier_invoice  text,
  received_on       date NOT NULL,
  total_paise       bigint NOT NULL CHECK (total_paise >= 0),
  notes             text,
  created_by        bigint,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, ref),
  FOREIGN KEY (company_id, supplier_id) REFERENCES suppliers (company_id, id)
);
CREATE INDEX purchases_date_idx ON purchases (company_id, received_on DESC);

CREATE TABLE purchase_lines (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id       bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  purchase_id      bigint NOT NULL,
  product_id       bigint NOT NULL,
  qty              numeric(12,3) NOT NULL CHECK (qty > 0),
  unit_cost_paise  bigint NOT NULL CHECK (unit_cost_paise >= 0),
  FOREIGN KEY (company_id, purchase_id) REFERENCES purchases (company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, product_id) REFERENCES products (company_id, id)
);
CREATE INDEX purchase_lines_purchase_idx ON purchase_lines (company_id, purchase_id);

-- ---------------------------------------------------------------------------
-- Quotes and jobs
-- ---------------------------------------------------------------------------
CREATE TABLE quotes (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id         bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  ref                text NOT NULL,
  version            integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  lead_id            bigint NOT NULL,
  customer_id        bigint NOT NULL,
  survey_id          bigint NOT NULL,
  template_id        bigint NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('on_grid', 'off_grid', 'panel_set', 'service')),
  capacity_kw        numeric(4,1) NOT NULL CHECK (capacity_kw > 0),
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired', 'superseded')),
  valid_until        date NOT NULL,
  subtotal_paise     bigint NOT NULL DEFAULT 0 CHECK (subtotal_paise >= 0),
  discount_paise     bigint NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  tax_paise          bigint NOT NULL DEFAULT 0 CHECK (tax_paise >= 0),
  total_paise        bigint NOT NULL DEFAULT 0 CHECK (total_paise >= 0),
  subsidy_paise      bigint NOT NULL DEFAULT 0 CHECK (subsidy_paise >= 0),
  advance_percent    integer NOT NULL CHECK (advance_percent BETWEEN 0 AND 100),
  est_monthly_units  integer,
  notes              text,
  public_token       text NOT NULL UNIQUE,
  sent_at            timestamptz,
  decided_at         timestamptz,
  accepted_name      text,
  rejected_reason    text,
  created_by         bigint,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, ref, version),
  FOREIGN KEY (company_id, lead_id) REFERENCES leads (company_id, id),
  FOREIGN KEY (company_id, customer_id) REFERENCES customers (company_id, id),
  -- the brief: only after the survey is approved should the customer receive a quote
  FOREIGN KEY (company_id, survey_id) REFERENCES surveys (company_id, id),
  FOREIGN KEY (company_id, template_id) REFERENCES kit_templates (company_id, id),
  CHECK (discount_paise <= subtotal_paise),
  CHECK (status <> 'accepted' OR (accepted_name IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK (status NOT IN ('sent', 'accepted', 'rejected') OR sent_at IS NOT NULL)
);
CREATE INDEX quotes_lead_idx ON quotes (company_id, lead_id, version DESC);
CREATE INDEX quotes_status_idx ON quotes (company_id, status, created_at DESC);
-- at most one live (non-replaced) version per quote reference
CREATE UNIQUE INDEX quotes_one_live_version ON quotes (company_id, ref) WHERE status <> 'superseded';

CREATE TABLE quote_lines (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id        bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  quote_id          bigint NOT NULL,
  product_id        bigint NOT NULL,
  description       text NOT NULL,
  qty               numeric(12,3) NOT NULL CHECK (qty > 0),
  unit_price_paise  bigint NOT NULL CHECK (unit_price_paise >= 0),
  gst_rate_bp       integer NOT NULL CHECK (gst_rate_bp IN (0, 500, 1200, 1800, 2800)),
  amount_paise      bigint NOT NULL CHECK (amount_paise >= 0),
  rule_explain      text,
  sort              integer NOT NULL DEFAULT 0,
  FOREIGN KEY (company_id, quote_id) REFERENCES quotes (company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, product_id) REFERENCES products (company_id, id)
);
CREATE INDEX quote_lines_quote_idx ON quote_lines (company_id, quote_id, sort);

CREATE TABLE jobs (
  id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id              bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  ref                     text NOT NULL,
  quote_id                bigint NOT NULL,
  lead_id                 bigint NOT NULL,
  customer_id             bigint NOT NULL,
  kind                    text NOT NULL CHECK (kind IN ('on_grid', 'off_grid', 'panel_set', 'service')),
  capacity_kw             numeric(4,1) NOT NULL,
  status                  text NOT NULL DEFAULT 'awaiting_advance'
                          CHECK (status IN ('awaiting_advance', 'confirmed', 'packed', 'dispatched', 'delivered', 'installed', 'closed', 'cancelled')),
  total_paise             bigint NOT NULL CHECK (total_paise >= 0),
  revenue_ex_tax_paise    bigint NOT NULL CHECK (revenue_ex_tax_paise >= 0),
  advance_required_paise  bigint NOT NULL CHECK (advance_required_paise >= 0),
  subsidy_applicable      boolean NOT NULL DEFAULT false,
  confirmed_at            timestamptz,
  packed_at               timestamptz,
  dispatched_at           timestamptz,
  delivered_on            date,
  installed_at            timestamptz,
  closed_at               timestamptz,
  cancelled_reason        text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, ref),
  UNIQUE (company_id, quote_id),
  FOREIGN KEY (company_id, quote_id) REFERENCES quotes (company_id, id),
  FOREIGN KEY (company_id, lead_id) REFERENCES leads (company_id, id),
  FOREIGN KEY (company_id, customer_id) REFERENCES customers (company_id, id),
  CHECK (advance_required_paise <= total_paise),
  CHECK (status = 'awaiting_advance' OR status = 'cancelled' OR confirmed_at IS NOT NULL),
  CHECK (status NOT IN ('dispatched', 'delivered', 'installed', 'closed') OR dispatched_at IS NOT NULL),
  CHECK (status NOT IN ('delivered', 'installed', 'closed') OR delivered_on IS NOT NULL),
  CHECK (status NOT IN ('installed', 'closed') OR installed_at IS NOT NULL),
  CHECK (status <> 'cancelled' OR cancelled_reason IS NOT NULL)
);
CREATE INDEX jobs_status_idx ON jobs (company_id, status, created_at DESC);
CREATE INDEX jobs_customer_idx ON jobs (company_id, customer_id);

CREATE TABLE job_lines (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id        bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  job_id            bigint NOT NULL,
  product_id        bigint NOT NULL,
  description       text NOT NULL,
  qty               numeric(12,3) NOT NULL CHECK (qty > 0),
  unit_price_paise  bigint NOT NULL CHECK (unit_price_paise >= 0),
  gst_rate_bp       integer NOT NULL,
  amount_paise      bigint NOT NULL CHECK (amount_paise >= 0),
  sort              integer NOT NULL DEFAULT 0,
  FOREIGN KEY (company_id, job_id) REFERENCES jobs (company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, product_id) REFERENCES products (company_id, id)
);
CREATE INDEX job_lines_job_idx ON job_lines (company_id, job_id, sort);

CREATE TABLE visit_links (
  company_id  bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  visit_id    bigint NOT NULL PRIMARY KEY,
  job_id      bigint,
  survey_id   bigint,
  ticket_id   bigint,
  FOREIGN KEY (company_id, visit_id) REFERENCES visits (company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, job_id) REFERENCES jobs (company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, survey_id) REFERENCES surveys (company_id, id) ON DELETE CASCADE,
  CHECK (num_nonnulls(job_id, survey_id, ticket_id) = 1)
);
CREATE INDEX visit_links_job_idx ON visit_links (company_id, job_id) WHERE job_id IS NOT NULL;
CREATE INDEX visit_links_ticket_idx ON visit_links (company_id, ticket_id) WHERE ticket_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Pick lists, serial numbers, dispatch and warranty
-- ---------------------------------------------------------------------------
CREATE TABLE pick_lists (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id      bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  ref             text NOT NULL,
  job_id          bigint NOT NULL,
  status          text NOT NULL DEFAULT 'ready' CHECK (status IN ('waiting_stock', 'ready', 'packed', 'dispatched', 'delivered', 'cancelled')),
  packed_at       timestamptz,
  dispatched_at   timestamptz,
  dispatched_by   bigint,
  vehicle_no      text,
  driver_name     text,
  driver_phone    text,
  goods_value_paise bigint,
  delivered_on    date,
  received_by     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, ref),
  UNIQUE (company_id, job_id),
  FOREIGN KEY (company_id, job_id) REFERENCES jobs (company_id, id),
  CHECK (status NOT IN ('dispatched', 'delivered') OR (dispatched_at IS NOT NULL AND vehicle_no IS NOT NULL AND driver_name IS NOT NULL)),
  CHECK (status <> 'delivered' OR (delivered_on IS NOT NULL AND received_by IS NOT NULL))
);
CREATE INDEX pick_lists_status_idx ON pick_lists (company_id, status);

CREATE TABLE pick_lines (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  pick_list_id bigint NOT NULL,
  product_id  bigint NOT NULL,
  qty         numeric(12,3) NOT NULL CHECK (qty > 0),
  UNIQUE (company_id, id),
  UNIQUE (pick_list_id, product_id),
  FOREIGN KEY (company_id, pick_list_id) REFERENCES pick_lists (company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, product_id) REFERENCES products (company_id, id)
);

CREATE TABLE serial_units (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id        bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  product_id        bigint NOT NULL,
  serial            text NOT NULL CHECK (serial = upper(serial) AND length(serial) BETWEEN 4 AND 40),
  status            text NOT NULL DEFAULT 'in_stock'
                    CHECK (status IN ('in_stock', 'allocated', 'dispatched', 'installed', 'faulty', 'replaced', 'scrapped')),
  unit_cost_paise   bigint NOT NULL DEFAULT 0 CHECK (unit_cost_paise >= 0),
  purchase_id       bigint,
  job_id            bigint,
  pick_list_id      bigint,
  ticket_id         bigint,
  customer_id       bigint,
  scanned_at        timestamptz,
  scanned_by        bigint,
  warranty_start    date,
  warranty_end      date,
  replaced_by_id    bigint,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, product_id, serial),
  FOREIGN KEY (company_id, product_id) REFERENCES products (company_id, id),
  FOREIGN KEY (company_id, purchase_id) REFERENCES purchases (company_id, id),
  FOREIGN KEY (company_id, job_id) REFERENCES jobs (company_id, id),
  FOREIGN KEY (company_id, pick_list_id) REFERENCES pick_lists (company_id, id),
  FOREIGN KEY (company_id, customer_id) REFERENCES customers (company_id, id),
  FOREIGN KEY (company_id, replaced_by_id) REFERENCES serial_units (company_id, id),
  -- which unit went to which customer is always known once it leaves stock
  CHECK (status IN ('in_stock', 'scrapped') OR customer_id IS NOT NULL OR status = 'faulty'),
  CHECK (status <> 'allocated' OR (pick_list_id IS NOT NULL AND scanned_at IS NOT NULL)),
  CHECK ((warranty_start IS NULL) = (warranty_end IS NULL)),
  CHECK (warranty_end IS NULL OR warranty_end > warranty_start),
  CHECK (status <> 'installed' OR warranty_start IS NOT NULL)
);
CREATE INDEX serial_units_serial_trgm ON serial_units USING gin (serial gin_trgm_ops);
CREATE INDEX serial_units_customer_idx ON serial_units (company_id, customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX serial_units_stock_idx ON serial_units (company_id, product_id, status);
CREATE INDEX serial_units_pick_idx ON serial_units (company_id, pick_list_id) WHERE pick_list_id IS NOT NULL;

-- Append-only stock ledger. Parts cost per job comes from here.
CREATE TABLE stock_moves (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id       bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  product_id       bigint NOT NULL,
  direction        text NOT NULL CHECK (direction IN ('in', 'out')),
  qty              numeric(12,3) NOT NULL CHECK (qty > 0),
  unit_cost_paise  bigint NOT NULL CHECK (unit_cost_paise >= 0),
  reason           text NOT NULL CHECK (reason IN ('purchase', 'dispatch', 'service_part', 'adjustment', 'return')),
  job_id           bigint,
  ticket_id        bigint,
  purchase_id      bigint,
  serial_unit_id   bigint,
  note             text,
  created_by       bigint,
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, product_id) REFERENCES products (company_id, id),
  FOREIGN KEY (company_id, job_id) REFERENCES jobs (company_id, id),
  FOREIGN KEY (company_id, purchase_id) REFERENCES purchases (company_id, id),
  FOREIGN KEY (company_id, serial_unit_id) REFERENCES serial_units (company_id, id)
);
CREATE INDEX stock_moves_product_idx ON stock_moves (company_id, product_id, created_at DESC);
CREATE INDEX stock_moves_job_idx ON stock_moves (company_id, job_id) WHERE job_id IS NOT NULL;
CREATE INDEX stock_moves_ticket_idx ON stock_moves (company_id, ticket_id) WHERE ticket_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- On the roof
-- ---------------------------------------------------------------------------
CREATE TABLE install_reports (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id             bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  job_id                 bigint NOT NULL,
  visit_id               bigint,
  started_at             timestamptz NOT NULL,
  finished_at            timestamptz NOT NULL,
  confirmed_kw           numeric(4,1) NOT NULL CHECK (confirmed_kw > 0),
  size_mismatch_reason   text,
  generation_kw          numeric(6,2) NOT NULL CHECK (generation_kw > 0),
  chk_structure          boolean NOT NULL CHECK (chk_structure),
  chk_panels             boolean NOT NULL CHECK (chk_panels),
  chk_wiring             boolean NOT NULL CHECK (chk_wiring),
  chk_earthing           boolean NOT NULL CHECK (chk_earthing),
  chk_generation         boolean NOT NULL CHECK (chk_generation),
  signature_file_id      bigint NOT NULL,
  signed_by_name         text NOT NULL,
  notes                  text,
  submitted_by           bigint,
  submitted_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, job_id),
  FOREIGN KEY (company_id, job_id) REFERENCES jobs (company_id, id),
  FOREIGN KEY (company_id, signature_file_id) REFERENCES files (company_id, id),
  CHECK (finished_at > started_at AND finished_at - started_at <= interval '16 hours')
);

CREATE TABLE install_photos (
  company_id  bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  report_id   bigint NOT NULL,
  file_id     bigint NOT NULL,
  PRIMARY KEY (report_id, file_id),
  FOREIGN KEY (company_id, report_id) REFERENCES install_reports (company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, file_id) REFERENCES files (company_id, id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Service tickets
-- ---------------------------------------------------------------------------
CREATE TABLE tickets (
  id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id              bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  ref                     text NOT NULL,
  customer_id             bigint NOT NULL,
  job_id                  bigint,
  serial_unit_id          bigint,
  channel                 text NOT NULL CHECK (channel IN ('call', 'whatsapp', 'portal', 'email', 'visit')),
  fault_code              text,
  description             text NOT NULL,
  priority                text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status                  text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'in_progress', 'resolved', 'closed')),
  coverage                text NOT NULL CHECK (coverage IN ('warranty', 'paid', 'goodwill')),
  warranty_end_at_open    date,
  assigned_to             bigint,
  resolution              text,
  labour_hours            numeric(5,2) CHECK (labour_hours IS NULL OR labour_hours BETWEEN 0 AND 24),
  parts_cost_paise        bigint NOT NULL DEFAULT 0 CHECK (parts_cost_paise >= 0),
  labour_cost_paise       bigint NOT NULL DEFAULT 0 CHECK (labour_cost_paise >= 0),
  billed_paise            bigint NOT NULL DEFAULT 0 CHECK (billed_paise >= 0),
  resolved_at             timestamptz,
  customer_confirmed_at   timestamptz,
  confirm_method          text CHECK (confirm_method IN ('portal', 'phone', 'on_site')),
  reopen_count            integer NOT NULL DEFAULT 0 CHECK (reopen_count >= 0),
  closed_at               timestamptz,
  created_by              bigint,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, ref),
  FOREIGN KEY (company_id, customer_id) REFERENCES customers (company_id, id),
  FOREIGN KEY (company_id, job_id) REFERENCES jobs (company_id, id),
  FOREIGN KEY (company_id, serial_unit_id) REFERENCES serial_units (company_id, id),
  FOREIGN KEY (company_id, assigned_to) REFERENCES users (company_id, id) ON DELETE SET NULL (assigned_to),
  -- covered repairs cost the customer nothing
  CHECK (coverage = 'paid' OR billed_paise = 0),
  CHECK (status NOT IN ('resolved', 'closed') OR (resolved_at IS NOT NULL AND resolution IS NOT NULL)),
  -- a ticket closes only when the customer confirms everything works
  CHECK (status <> 'closed' OR (customer_confirmed_at IS NOT NULL AND confirm_method IS NOT NULL AND closed_at IS NOT NULL))
);
CREATE INDEX tickets_status_idx ON tickets (company_id, status, created_at DESC);
CREATE INDEX tickets_customer_idx ON tickets (company_id, customer_id);
CREATE INDEX tickets_job_idx ON tickets (company_id, job_id) WHERE job_id IS NOT NULL;

ALTER TABLE serial_units ADD FOREIGN KEY (company_id, ticket_id) REFERENCES tickets (company_id, id);
ALTER TABLE stock_moves ADD FOREIGN KEY (company_id, ticket_id) REFERENCES tickets (company_id, id);
ALTER TABLE visit_links ADD FOREIGN KEY (company_id, ticket_id) REFERENCES tickets (company_id, id) ON DELETE CASCADE;

CREATE TABLE ticket_parts (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id               bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  ticket_id                bigint NOT NULL,
  product_id               bigint NOT NULL,
  qty                      numeric(12,3) NOT NULL CHECK (qty > 0),
  unit_cost_paise          bigint NOT NULL CHECK (unit_cost_paise >= 0),
  unit_price_paise         bigint NOT NULL CHECK (unit_price_paise >= 0),
  new_serial_unit_id       bigint,
  replaced_serial_unit_id  bigint,
  FOREIGN KEY (company_id, ticket_id) REFERENCES tickets (company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (company_id, product_id) REFERENCES products (company_id, id),
  FOREIGN KEY (company_id, new_serial_unit_id) REFERENCES serial_units (company_id, id),
  FOREIGN KEY (company_id, replaced_serial_unit_id) REFERENCES serial_units (company_id, id)
);
CREATE INDEX ticket_parts_ticket_idx ON ticket_parts (company_id, ticket_id);

-- ---------------------------------------------------------------------------
-- Money: payments, invoices, expenses, timesheets, pay runs, subsidy
-- ---------------------------------------------------------------------------
CREATE TABLE invoices (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id      bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  number          text NOT NULL,
  customer_id     bigint NOT NULL,
  job_id          bigint,
  ticket_id       bigint,
  kind            text NOT NULL CHECK (kind IN ('system', 'service')),
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'partially_paid', 'paid', 'void')),
  issued_on       date NOT NULL,
  due_on          date NOT NULL,
  subtotal_paise  bigint NOT NULL CHECK (subtotal_paise >= 0),
  discount_paise  bigint NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  tax_paise       bigint NOT NULL CHECK (tax_paise >= 0),
  total_paise     bigint NOT NULL CHECK (total_paise >= 0),
  public_token    text NOT NULL UNIQUE,
  sent_at         timestamptz,
  void_reason     text,
  created_by      bigint,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, number),
  FOREIGN KEY (company_id, customer_id) REFERENCES customers (company_id, id),
  FOREIGN KEY (company_id, job_id) REFERENCES jobs (company_id, id),
  FOREIGN KEY (company_id, ticket_id) REFERENCES tickets (company_id, id),
  CHECK (num_nonnulls(job_id, ticket_id) = 1),
  CHECK ((kind = 'system') = (job_id IS NOT NULL)),
  CHECK (due_on >= issued_on),
  CHECK (status <> 'void' OR void_reason IS NOT NULL)
);
-- one live invoice per job and per ticket
CREATE UNIQUE INDEX invoices_job_uq ON invoices (company_id, job_id) WHERE job_id IS NOT NULL AND status <> 'void';
CREATE UNIQUE INDEX invoices_ticket_uq ON invoices (company_id, ticket_id) WHERE ticket_id IS NOT NULL AND status <> 'void';
CREATE INDEX invoices_status_idx ON invoices (company_id, status, issued_on DESC);

CREATE TABLE invoice_lines (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id        bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  invoice_id        bigint NOT NULL,
  description       text NOT NULL,
  hsn               text,
  qty               numeric(12,3) NOT NULL CHECK (qty > 0),
  unit_price_paise  bigint NOT NULL CHECK (unit_price_paise >= 0),
  gst_rate_bp       integer NOT NULL,
  amount_paise      bigint NOT NULL CHECK (amount_paise >= 0),
  sort              integer NOT NULL DEFAULT 0,
  FOREIGN KEY (company_id, invoice_id) REFERENCES invoices (company_id, id) ON DELETE CASCADE
);
CREATE INDEX invoice_lines_invoice_idx ON invoice_lines (company_id, invoice_id, sort);

CREATE TABLE payments (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id    bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  ref           text NOT NULL,
  customer_id   bigint NOT NULL,
  job_id        bigint,
  invoice_id    bigint,
  amount_paise  bigint NOT NULL CHECK (amount_paise > 0),
  method        text NOT NULL CHECK (method IN ('upi', 'bank_transfer', 'cash', 'cheque', 'card')),
  reference     text,
  received_on   date NOT NULL,
  note          text,
  recorded_by   bigint,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, ref),
  FOREIGN KEY (company_id, customer_id) REFERENCES customers (company_id, id),
  FOREIGN KEY (company_id, job_id) REFERENCES jobs (company_id, id),
  FOREIGN KEY (company_id, invoice_id) REFERENCES invoices (company_id, id),
  CHECK (num_nonnulls(job_id, invoice_id) >= 1)
);
CREATE INDEX payments_job_idx ON payments (company_id, job_id) WHERE job_id IS NOT NULL;
CREATE INDEX payments_invoice_idx ON payments (company_id, invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX payments_date_idx ON payments (company_id, received_on DESC);

CREATE TABLE expenses (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id    bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  job_id        bigint NOT NULL,
  category      text NOT NULL CHECK (category IN ('transport', 'crane', 'food', 'permit', 'subcontract', 'misc')),
  amount_paise  bigint NOT NULL CHECK (amount_paise > 0),
  spent_on      date NOT NULL,
  note          text,
  recorded_by   bigint,
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, job_id) REFERENCES jobs (company_id, id)
);
CREATE INDEX expenses_job_idx ON expenses (company_id, job_id);

CREATE TABLE payruns (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id    bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  ref           text NOT NULL,
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'paid')),
  total_paise   bigint NOT NULL DEFAULT 0 CHECK (total_paise >= 0),
  paid_at       timestamptz,
  created_by    bigint,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, ref),
  CHECK (period_end >= period_start),
  CHECK ((status = 'paid') = (paid_at IS NOT NULL))
);

CREATE TABLE timesheets (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id     bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  technician_id  bigint NOT NULL,
  job_id         bigint,
  ticket_id      bigint,
  visit_id       bigint,
  work_date      date NOT NULL,
  hours          numeric(5,2) NOT NULL CHECK (hours > 0 AND hours <= 16),
  rate_paise     bigint NOT NULL CHECK (rate_paise >= 0),
  cost_paise     bigint NOT NULL CHECK (cost_paise >= 0),
  source         text NOT NULL CHECK (source IN ('installation', 'service', 'survey', 'manual')),
  note           text,
  payrun_id      bigint,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, technician_id) REFERENCES users (company_id, id),
  FOREIGN KEY (company_id, job_id) REFERENCES jobs (company_id, id),
  FOREIGN KEY (company_id, ticket_id) REFERENCES tickets (company_id, id),
  FOREIGN KEY (company_id, payrun_id) REFERENCES payruns (company_id, id) ON DELETE SET NULL (payrun_id)
);
CREATE INDEX timesheets_tech_idx ON timesheets (company_id, technician_id, work_date);
CREATE INDEX timesheets_job_idx ON timesheets (company_id, job_id) WHERE job_id IS NOT NULL;
CREATE INDEX timesheets_unpaid_idx ON timesheets (company_id, work_date) WHERE payrun_id IS NULL;

CREATE TABLE subsidy_cases (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id        bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  job_id            bigint NOT NULL,
  scheme            text NOT NULL DEFAULT 'PM Surya Ghar',
  expected_paise    bigint NOT NULL CHECK (expected_paise >= 0),
  status            text NOT NULL DEFAULT 'not_started'
                    CHECK (status IN ('not_started', 'documents', 'applied', 'inspection', 'approved', 'disbursed', 'rejected')),
  application_no    text,
  docs_bill         boolean NOT NULL DEFAULT false,
  docs_id           boolean NOT NULL DEFAULT false,
  docs_bank         boolean NOT NULL DEFAULT false,
  docs_photo        boolean NOT NULL DEFAULT false,
  applied_on        date,
  disbursed_on      date,
  disbursed_paise   bigint CHECK (disbursed_paise IS NULL OR disbursed_paise >= 0),
  note              text,
  stage_changed_at  timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, job_id),
  FOREIGN KEY (company_id, job_id) REFERENCES jobs (company_id, id),
  CHECK (status NOT IN ('applied', 'inspection', 'approved', 'disbursed') OR (application_no IS NOT NULL AND applied_on IS NOT NULL)),
  CHECK (status <> 'disbursed' OR (disbursed_on IS NOT NULL AND disbursed_paise IS NOT NULL))
);

-- ---------------------------------------------------------------------------
-- History, notifications, sharing
-- ---------------------------------------------------------------------------
-- Everything that happens to a customer, in order: the enquiry never vanishes.
CREATE TABLE activities (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id   bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  customer_id  bigint NOT NULL,
  lead_id      bigint,
  job_id       bigint,
  ticket_id    bigint,
  kind         text NOT NULL CHECK (kind IN ('note', 'call', 'whatsapp', 'system')),
  body         text NOT NULL,
  actor_id     bigint,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, customer_id) REFERENCES customers (company_id, id),
  FOREIGN KEY (company_id, lead_id) REFERENCES leads (company_id, id),
  FOREIGN KEY (company_id, job_id) REFERENCES jobs (company_id, id),
  FOREIGN KEY (company_id, ticket_id) REFERENCES tickets (company_id, id)
);
CREATE INDEX activities_customer_idx ON activities (company_id, customer_id, created_at DESC);
CREATE INDEX activities_lead_idx ON activities (company_id, lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX activities_job_idx ON activities (company_id, job_id) WHERE job_id IS NOT NULL;
CREATE INDEX activities_ticket_idx ON activities (company_id, ticket_id) WHERE ticket_id IS NOT NULL;

CREATE TABLE notifications (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  user_id     bigint NOT NULL,
  title       text NOT NULL,
  body        text,
  link        text,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, user_id) REFERENCES users (company_id, id) ON DELETE CASCADE
);
CREATE INDEX notifications_user_idx ON notifications (company_id, user_id, created_at DESC);

-- Admin trail for settings, roles and prices.
CREATE TABLE audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  actor_id    bigint,
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   bigint,
  detail      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_company_idx ON audit_log (company_id, created_at DESC);

CREATE TABLE share_links (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id  bigint NOT NULL DEFAULT app_company() REFERENCES companies (id) ON DELETE CASCADE,
  token_hash  bytea NOT NULL UNIQUE,
  period      text NOT NULL CHECK (period IN ('today', 'week', 'month')),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_by  bigint,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Row-level security on every tenant table (FORCE: the owner is subject to it too)
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'sessions', 'auth_codes', 'sequences', 'customers', 'leads', 'files', 'visits', 'visit_crew',
    'surveys', 'survey_photos', 'products', 'kit_templates', 'kit_template_lines', 'suppliers', 'purchases', 'purchase_lines',
    'quotes', 'quote_lines', 'jobs', 'job_lines', 'visit_links', 'pick_lists', 'pick_lines', 'serial_units', 'stock_moves',
    'install_reports', 'install_photos', 'tickets', 'ticket_parts', 'invoices', 'invoice_lines', 'payments', 'expenses',
    'payruns', 'timesheets', 'subsidy_cases', 'activities', 'notifications', 'audit_log', 'share_links']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (app_bypass() OR company_id = app_company()) WITH CHECK (app_bypass() OR company_id = app_company())', t);
  END LOOP;
END $$;

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON companies USING (app_bypass() OR id = app_company()) WITH CHECK (app_bypass() OR id = app_company());

ALTER TABLE app_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_secrets FORCE ROW LEVEL SECURITY;
CREATE POLICY secrets_system_only ON app_secrets USING (app_bypass()) WITH CHECK (app_bypass());

-- ---------------------------------------------------------------------------
-- Database-level guarantees the brief states in words
-- ---------------------------------------------------------------------------
-- "Only after the survey is approved should the customer receive a quote."
CREATE OR REPLACE FUNCTION quotes_require_approved_survey() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM surveys s WHERE s.company_id = NEW.company_id AND s.id = NEW.survey_id AND s.status = 'approved') THEN
    RAISE EXCEPTION 'A quote needs an approved survey' USING ERRCODE = 'check_violation', CONSTRAINT = 'quotes_survey_approved';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER quotes_survey_approved BEFORE INSERT ON quotes FOR EACH ROW EXECUTE FUNCTION quotes_require_approved_survey();

-- Serial numbers leave the warehouse only on a dispatched pick list.
CREATE OR REPLACE FUNCTION serial_dispatch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'dispatched' AND OLD.status <> 'dispatched' AND OLD.status <> 'allocated' THEN
    RAISE EXCEPTION 'Serial % must be scanned before it leaves', NEW.serial USING ERRCODE = 'check_violation', CONSTRAINT = 'serial_scanned_before_dispatch';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER serial_dispatch_guard BEFORE UPDATE OF status ON serial_units FOR EACH ROW EXECUTE FUNCTION serial_dispatch_guard();
