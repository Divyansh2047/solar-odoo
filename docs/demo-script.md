# Demo script (about 5½ minutes)

One story: a homeowner from the web form to a free warranty repair 18 months later, ending on the
director’s numbers. Record at 1080p with two browser windows side by side for the live moments.
Start every take from a fresh demo workspace (landing page, **Open the live demo**).

| Time | Screen | Do | Say |
|---|---|---|---|
| 0:00–0:25 | Landing, top | Let the 3D rooftop sit for a second | “SunPower installs 40 rooftops a month and runs on WhatsApp and paper registers. Enquiries get lost, quotes miss parts, serial numbers vanish, and nobody knows which jobs made money. Arka fixes that, from the first enquiry to the twentieth year.” |
| 0:25–0:50 | Landing, scroll | Scroll through the week | “It’s built around the brief’s own week: enquiry, survey, kit, dispatch, roof, rain, month-end.” |
| 0:50–1:10 | Click **Open the live demo** | Dashboard appears | “Each visitor gets a private copy of SunPower with three months of history: about 40 jobs a month, 15 technicians.” |
| 1:10–1:45 | Second window: `/enquire/<key>` (Enquiries → Copy web form link) | Fill the public form: 3 kW, subsidy | “A homeowner asks for 3 kW under the subsidy…” Switch window: the enquiry appears in sales without a reload, with a notification. “…and it lands with sales straight away. It can never be deleted; closing it needs a reason.” |
| 1:45–2:15 | Enquiry page | Log a call, fill the qualification (roof 450 sq ft, bill ₹3,200) | “On the call we check roof space, bill and grid. Arka suggests the size live and the subsidy.” Book a survey: “It only offers technicians who are free.” |
| 2:15–2:45 | Roof surveys → the one waiting for approval | Show direction, tilt, cable run, photo; Approve | “The technician measured it on their phone. Only an approved survey can become a quote; the database enforces it.” |
| 2:45–3:15 | Make the quote | ONG-3 → quote page | “The quote comes from a template, and the exact parts list follows by itself: panels, inverter, stands, switches, earthing. The DC cable length comes from the measured 20 m run. Subsidy, savings and payback are on it.” Send; open the customer link; accept. |
| 3:15–3:45 | Job page → Record payment (advance) | Toast: order confirmed | “The advance confirms the order: the warehouse gets a pick list and the crew gets the job on their schedule. Nobody phones anyone.” |
| 3:45–4:15 | Warehouse → Bharatbhai’s packed kit (₹2 lakh of inverters and batteries) | Show 14/14 serials, try scanning a wrong serial, Dispatch | “Every inverter, battery, controller and panel is scanned before the truck leaves; a wrong scan says exactly why.” Mark delivered: “The warranty clock starts by itself: 2 years for the inverter, 20 for panels.” |
| 4:15–4:35 | See it as: Technician, phone width | Meera Joshi’s installation report | “On the roof: times, size, test reading, photos, and the homeowner signs on the screen.” |
| 4:35–5:05 | Ctrl K, type part of an inverter serial | Dipika Raval, “Covered” | **The moment.** “Eighteen months later it’s pouring and the inverter shows E-021. Support types four digits, finds her and the unit in milliseconds, and sees it’s covered. The replacement costs her nothing, and the cost lands on the original job, so the director sees the true profit.” |
| 5:05–5:25 | Today (director) | This month, profit per job | “Which installations made money, which lost money: two lost money, and you can see why. What’s unfinished, invoices to send, subsidy paperwork, technicians to pay. Share the numbers with a read-only link.” |
| 5:25–5:40 | Close | Dark mode toggle, phone view | “One TypeScript codebase, PostgreSQL with row-level security per company, 48 integration tests on a real database, end-to-end tests, built with an AI coding assistant under our direction. Arka: from the first enquiry to the twentieth year.” |

## Judge Q&A (one line each)

- **How is each company’s data kept apart?** PostgreSQL row-level security on every table (forced, fail-closed), composite foreign keys, and a startup self-test; tests prove another workspace sees nothing.
- **What stops two people booking the same technician?** A database exclusion constraint on the technician’s time ranges.
- **What stops a quote without a survey, or a truck leaving unscanned?** Database triggers, not just screens.
- **How are warranties calculated?** On delivery: start date + the product’s warranty months, per serial; replacements keep the original end date.
- **Is the OTP secure?** Stored only as an HMAC, 10-minute expiry, 5 attempts, lockout that survives errors, generic answers for unknown emails.
- **How would it scale?** Stateless API; live updates already go through Postgres LISTEN/NOTIFY, so several instances work; managed Postgres.
- **How did you use AI?** Honestly described in the README: an AI assistant wrote much of the code under the team’s direction; the team owned decisions and testing.
