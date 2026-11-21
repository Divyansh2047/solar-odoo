# Build progress (working notes)

Updated as the build goes, so anyone (or a fresh session) can pick up exactly where it stands.

## Done
- Docs: requirements matrix, decision log (domain, design and security decisions), design direction, demo script.
- Shared package: money/dates/format helpers, solar maths, enums, permissions, zod schemas (client and server).
- Database schema with RLS, composite FKs, exclusion constraint (no double booking), triggers (quote needs approved survey; serials scanned before dispatch).
- Domain engine for every scene of the brief; HTTP API; public routes; demo template simulation + fast clone.
- Frontend: every screen (auth, director dashboard, sales desk, technician day, enquiries, surveys, quotes, jobs, install report, warehouse, pick list with scanning, schedule, service, tickets, money, invoices, month-end, catalogue, settings, customer, serial) and public pages (enquiry form, quote, invoice, customer page, shared report).
- 3D: KitViewer (job/quote/customer pages; labels in the gutters with leader lines, SVG fallback without WebGL) and the scroll-driven landing story, in a lazy chunk.
- Independent security review: every blocking and should-fix item applied (need-to-know responses, replaceable customer links, email after commit, web-form overwrite guard, per-account sign-in limiter, upload and demo caps). Four new tests cover them.
- Independent design critique of 92 screenshots (30 findings): fixed the schedule grid (rows now grow; phones get a day list), the warranty ruler's scale, phone overflow on the quote, dark-mode controls and KPI module, tinted status chips, ticket and enquiry primary actions that follow the state, phone chrome (one-row demo banner, one menu), sideways-scrolling tabs, 44 px touch targets, the scan field, money formatting (full amounts in tables, true minus signs), month-end "unfinished" answer, warehouse highlight, public enquiry page, demo data (unique names and phones, varied survey times). Kept, with reasons in decisions.md: the On-Grid charge controller and 24-month warranties (both from the brief).
- Demo simulation: every story completes (0 dropped). A kit that is short of stock now waits for the top-up instead of stopping half-way; if a story ever does stop, its order is cancelled with a reason, so nothing sits in the warehouse for months.
- Verification (production build on :4100): 52 backend tests pass; 9/9 end-to-end checks with 0 console errors; axe audit (13 screens, light and dark) 0 violations; screenshot matrix re-shot, with a check that no page scrolls sideways.
- Deploy files: Dockerfile, render.yaml (Blueprint), CI workflow, .env.example, README with honest "How we built it".

## Remaining
- Human steps: GitHub repo + push, Render Blueprint deploy (paid or non-expiring database), Resend sending domain, custom domain DNS. Rotate any credentials that were exposed in round 1.
- Team names in the README.
