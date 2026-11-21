# Arka

**From the first enquiry to the twentieth year.**

Arka is the operations platform for a rooftop solar installer. It takes a customer from the first
quote request to the 20-year panel warranty: enquiries that can’t get lost, roof surveys measured on
a phone, quotes whose parts list writes itself, serial numbers scanned at dispatch, warranties that
start on their own, a sign-off form with the homeowner’s signature, service tickets that bill (or
don’t) automatically, and a director’s view of which jobs made money.

Built for the Odoo hackathon final: *Solar Installation Management System* (“SunPower Solutions”).

- **One-click demo:** open the app and press **Open the live demo**. You get a private copy of
  SunPower Solutions with about three months of history (around 40 rooftops a month), deleted after
  24 hours. Use **See it as** in the yellow bar to switch between director, sales, technician,
  warehouse, support and accounts.
- **Live URL:** https://arka.scriptjacker.in

---

## The brief, scene by scene

| Scene in the brief | What Arka does | Where |
|---|---|---|
| **The rooftop inquiry**: online form for 3 kW under the subsidy; lands with sales straight away; never vanishes | Public enquiry form (embeddable) per company. New enquiries appear live in sales with a notification. Repeat enquiries from the same phone attach to the open one. Enquiries can’t be deleted; closing needs a reason. Uncalled enquiries turn red after the response time. | `/enquire/<key>`, Enquiries |
| Call to check shadow-free roof, bill, grid suitability | Qualification call form with a live size recommendation (bill → kW, capped by roof area) and subsidy estimate | Enquiry page |
| Technician measures direction, tilt, cable distance | Phone form: compass buttons or the phone’s own compass, tilt, cable run, photos (shrunk on the phone), expected generation | Roof surveys |
| **Only after the survey is approved** does the customer get a quote | Enforced in the app **and by a database trigger** | Survey approval |
| **Getting the kit right**: quote from a ready template; the exact parts list follows on its own | 12 kit templates (Solar Panel Set, On-Grid 1–5 kW, Off-Grid 1–5 kW, Installation). Lines use rules: fixed, per kW, per panel, and **cable run from the survey’s measured distance**. Subsidy (PM Surya Ghar), savings and payback on the quote; a public link the customer can accept. | Quotes, `/q/<token>` |
| Advance or full payment; then the warehouse knows what to pack and the crew sees the job, **without anyone phoning** | Recording the advance confirms the order: a pick list is created and an installation visit is booked on the first day enough technicians are free; both get notifications | Job page, Warehouse, Schedule |
| **Dispatch day**: every inverter, battery and charge controller scanned before the truck leaves; which unit went to which customer | Scanning by camera (barcode/QR), USB scanner or typing. Every refused scan says why (unknown serial, wrong product, already on another customer’s job, line complete). Dispatch is refused until every serial is scanned (**also a database trigger**). Shows the stock value on the truck. | Pick list |
| **Warranty clock starts by itself** on delivery: 2 years inverter/battery, 20 years panels | Marking delivered sets each serial’s warranty from its product (24 or 240 months). Nobody types a date. | Job page, Customer page |
| **On the roof**: start/finish, system size, photos, homeowner signs on screen | Phone form with checklist, test reading, ≥ 2 photos, signature pad. Keeps a draft on the phone if the signal drops. Signing books crew hours to the job and drafts the invoice. | Install report |
| Proof of the job; customer has no doubt what was installed | Customer page (“My solar”): system in 3D, every serial with a warranty ruler, photos, signature, printable certificate | `/my/<token>` |
| **The rainy season breakdown**: find the customer and inverter serial within seconds; is it covered? | Search by any fragment of a serial, phone or name (Ctrl K anywhere), with warranty status on the result | Service, search |
| Covered → costs nothing; not covered → parts and labour billed automatically; tracked until the customer confirms | Coverage decided when the ticket opens. Covered repairs bill ₹0 (the cost is charged to the original job). Out of warranty → an invoice is created from parts + labour on resolve. Replacements keep the original warranty. Tickets close only after the customer confirms (on their page, or a logged confirmation). | Ticket page |
| **The director’s month-end**: which jobs made money, which lost money, what’s unfinished; today / week / month; invoices, subsidy paperwork, technicians to pay; share the numbers | Dashboard with a period switch; profit per job = revenue ex-GST − parts at cost − crew hours − expenses − free warranty repairs; unfinished list with the next step; subsidy pipeline; pay runs from timesheets; read-only expiring share link and CSV | Today, Month-end, Money |

## Beyond the brief

1. **3D that carries data.** The landing page replays the brief’s week in 3D. The job, quote and
   customer pages draw the *actual* kit: panel count, inverter, battery bank.
2. **One serial tells the whole story.** Type part of a serial: the customer, the job, the warranty
   ruler and whether a repair is free. The repair’s cost then shows up in that job’s profit.
3. **Live everywhere.** Screens update by themselves across users (Postgres LISTEN/NOTIFY →
   server-sent events, works with several server instances).

## Quick start (local)

Needs Node 22+. No database install: a real PostgreSQL runs from `node_modules`.

```bash
npm install
npm run db      # starts local PostgreSQL on :54320 and writes .env (keep it running)
npm run seed    # optional: builds SunPower's history and a director login (printed to the terminal)
npm run dev     # API on :4000, app on http://localhost:5173
```

- Demo: press **Open the live demo** on the landing page (the first demo is prepared in about a
  minute after the server starts).
- Tests: `npm test` (real PostgreSQL), `npm run typecheck`, `BASE_URL=http://localhost:5173 npm run e2e`.
- Screenshots of every screen (desktop/phone, light/dark): `npm run shots`.

## Architecture

```
Browser ──► one origin ──► Express 5 (Node, TypeScript)
                            ├── /          landing + app (React 19, Vite, three.js lazy-loaded)
                            └── /api/*     JSON API ──► PostgreSQL ≥ 15 (row-level security)
                                            └── /api/events (SSE) ◄── LISTEN/NOTIFY
shared/  zod schemas, solar maths, money/date helpers: the same rules in the browser and the server
```

- **Database is the last line of defence**: money in paise, quantities in numeric(12,3), CHECK
  constraints on every lifecycle, an exclusion constraint so a technician can never be booked in two
  places at once, triggers for “quote needs an approved survey” and “serials scanned before dispatch”.
- **Workspaces are isolated by PostgreSQL row-level security** (forced, fail-closed), composite
  foreign keys so another workspace’s ids can’t be referenced, and a self-test at startup.
- **Demo workspaces**: a background job simulates months of SunPower’s life through the same domain
  functions the API uses (so stock always equals the ledger); each visitor gets a copy in under a
  second, with every id remapped, every public token regenerated and every date shifted to today.
- Decisions and trade-offs: [`docs/decisions.md`](docs/decisions.md). Requirements matrix:
  [`docs/requirements.md`](docs/requirements.md). Design direction: [`docs/design-direction.md`](docs/design-direction.md).

## Security

Opaque session tokens (only their SHA-256 stored) in httpOnly SameSite cookies; scrypt passwords;
constant-time sign-in with one message for wrong email or password; email verification and password
reset by 6-digit codes stored as HMACs, attempt-limited (5) and expiring (10 min), with lockout that
survives errors; CSRF defence by a required header plus Origin check; strict CSP (no inline scripts);
rate limits on auth (per IP and per account), forms and demos; role checks on every endpoint;
need-to-know responses (purchase costs, customer page links and job money are removed for roles that
don't use them); customer page links can be replaced if forwarded; emails sent only after the
transaction commits; uploads sniffed by magic bytes, served with `nosniff` and capped per workspace
per day; spreadsheet-injection-safe CSV; tokens never logged; codes redacted from logs. An independent
security review was run against the server; its findings and our decisions are in
[`docs/decisions.md`](docs/decisions.md).

## Tests

- **52 integration tests** on a real PostgreSQL: the brief’s week scene by scene (enquiry → survey →
  quote → advance → scanning → delivery warranty → install report → covered and billable repairs →
  director’s numbers), workspace isolation, account security, need-to-know responses and link
  replacement, solar maths, demo simulation and copy.
- **End-to-end smoke** (`e2e/smoke.mjs`, Playwright): landing, one-click demo, search in under two
  seconds, rainy-season ticket, a public enquiry appearing live in another session, dispatch, role
  switch on a phone, sign-up with email code.
- **Accessibility audit** (`e2e/a11y.mjs`, axe-core): 13 screens in light and dark against WCAG 2.1 AA.
- **Screenshot matrix** (`e2e/screenshots.mjs`): 23 screens × phone and desktop × light and dark, and
  a check that no page scrolls sideways. We review these after every round of UI changes.

## Deploy

Render Blueprint (`render.yaml`): Docker web service + PostgreSQL, `DATABASE_URL` wired by the
platform, `APP_SECRET` generated by the platform. Use a **database that doesn’t expire** before
judging (Render’s free database is deleted after 30 days). Set `APP_URL`, `MAIL_FROM` and
`RESEND_API_KEY` in the dashboard. Render’s free web services block SMTP, so email goes over HTTPS
(Resend), with SMTP as a fallback.

## Configuration

`DATABASE_URL`, `DATABASE_SSL`, `APP_URL`, `APP_SECRET` (optional; generated and stored if absent),
`TRUST_PROXY`, `MAIL_FROM`, `RESEND_API_KEY`, `SMTP_HOST/PORT/USER/PASS`, `OTP_DEV_ECHO` (development
only; refused in production), `DEMO_DAYS`, `LOG_LEVEL`. See `.env.example`.

## Roadmap

Purchase orders to suppliers, net-meter document generation, WhatsApp Business API intake, offline
installation forms (PWA), FIFO stock valuation, Hindi and Gujarati, customer generation monitoring
from inverter APIs.

## How we built it

Built by our team for the Odoo hackathon final, with the help of an AI coding assistant (Claude).
The team set the product direction and requirements, made the architecture and hosting decisions,
reviewed the work and tested the flows; much of the code was generated with the assistant under our
direction.

## Licence

MIT
