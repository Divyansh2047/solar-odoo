# Requirements matrix

Source: `Solar_Installation_Management_System.pdf` (4 pages, final round). Each row is a testable statement taken from the brief. Its wording is kept close to the brief because judges check it. "Evidence" names the automated test or screen that proves it.

Priority: **must** = stated in the brief · **should** = clearly implied by the brief · **wow** = beyond the brief, chosen to make the product stand out.

## Context from the brief

| ID | Requirement | Source | Priority | Evidence |
|---|---|---|---|---|
| C1 | One unified platform, taking a customer "from the first quote request to the 20-year warranty" | §1 | must | whole product; README demo path |
| C2 | Packages: **Solar Panel Set** (panels, connectors, wires) | §2 | must | seeded kit template `PANEL-SET` |
| C3 | **On-Grid System 1–5 kW**: inverter, wiring boxes, battery charge controller, panels, safety earthing, metal stands | §2 | must | kit templates `ONG-1..5`; test `kits.test` |
| C4 | **Off-Grid System 1–5 kW**: everything in On-Grid plus a large battery | §2 | must | kit templates `OFG-1..5`; test asserts superset + battery |
| C5 | **Installation (Service)**: fitting and testing by the crew on site | §2 | must | service product on every quote |
| C6 | Scale: about 40 rooftop projects a month, 15 technicians, high-value stock | §2 | should | seed data: ~40 jobs/month, 15 technicians |
| C7 | Today's pains: lost enquiries, hand-typed quotes with missed parts, serials on paper, site registers, no view of revenue and margins | §2 | must | each pain maps to a module below |

## Scene 1 — The rooftop inquiry

| ID | Requirement | Priority | Evidence |
|---|---|---|---|
| R1 | Homeowner fills an **online form** (name, phone, address, needs such as "3 kW under the subsidy") | must | public `/enquire` page; e2e |
| R2 | The enquiry lands with **the sales team straight away** | must | live push to Enquiries (SSE) + notification; e2e two sessions |
| R3 | The enquiry **should never vanish**: no hard delete, closing needs a reason, response-time flag, full history | must | test `leads.test` (delete refused, lost needs reason); "Needs a call" flag |
| R4 | Enquiries also come from **WhatsApp and calls**: staff can log them in one place with their source | must | "Log enquiry" form with source; filters by source |
| R5 | Qualification call records **shadow-free roof space, monthly electricity bill, grid connection suitability** | must | qualification form; test |
| R6 | If it looks good, a **technician survey**: **roof direction, tilt, cable distance** | must | survey form (mobile); test |
| R7 | **Only after the survey is approved** does the customer receive a quote | must | test: quote refused until survey approved |

## Scene 2 — Getting the kit right

| ID | Requirement | Priority | Evidence |
|---|---|---|---|
| R8 | The quote comes **from a ready template** | must | quote builder starts from kit template |
| R9 | The **exact list of parts follows on its own**: panels, inverter, stands, switches, wires, safety parts | must | BOM expansion test: 3 kW on-grid parts and quantities |
| R10 | Customer pays an **advance or the full amount** before work starts | must | payments; job can't be scheduled for install until the advance rule is met; test |
| R11 | Once the order is confirmed, **the warehouse knows what to pack** | must | pick list created automatically; test |
| R12 | The **crew sees the job on their schedule** without anyone phoning | must | installation visit auto-created on the schedule; live update; test |

## Scene 3 — Dispatch day and serial numbers

| ID | Requirement | Priority | Evidence |
|---|---|---|---|
| R13 | Every **inverter, battery and charge controller has its own serial number** (panels too, for their 20-year warranty) | must | serial-tracked products; serial units table |
| R14 | Each serial **must be scanned before it leaves the warehouse** | must | dispatch refused until every serial line is scanned; test |
| R15 | The company knows **exactly which unit went to which customer** | must | serial → job → customer lookup; test |
| R16 | Show the **value on the truck** (₹1,50,000 of inverters and batteries) | should | dispatch screen total |
| R17 | **The moment delivery is done, the warranty clock starts by itself** for every serial: e.g. 2 years inverter/battery, 20 years panels. **No one types dates** | must | test: mark delivered → warranty start/end per product |

## Scene 4 — On the roof

| ID | Requirement | Priority | Evidence |
|---|---|---|---|
| R18 | Crew opens a **simple form on phone or tablet** | must | mobile installation report; phone screenshots |
| R19 | Note **start and finish times** | must | validation: finish after start, not in the future |
| R20 | **Confirm the system size** | must | size must match the order or carry a reason |
| R21 | **Upload photos** of the finished roof | must | at least 2 photos, compressed on the phone |
| R22 | Crew **tests that power is being generated** (stands, panels, boxes, earthing done) | should | checklist + generation reading |
| R23 | **Homeowner signs on the screen** to accept the work | must | signature pad; required |
| R24 | **Clear proof of the job**; customer has **no doubt about what was installed** | must | installation certificate + customer page listing serials, photos, signature |

## Scene 5 — The rainy season breakdown

| ID | Requirement | Priority | Evidence |
|---|---|---|---|
| R25 | Support **finds the customer and the exact inverter serial within seconds** | must | global search by phone, name, serial (partial); e2e |
| R26 | Support **sees whether it is still under warranty** | must | warranty status on the search result and ticket |
| R27 | Under warranty → **repair or replacement costs the customer nothing** | must | test: covered ticket bills ₹0 |
| R28 | Not under warranty → **parts and labour billed automatically** | must | test: invoice created from parts + labour on resolve |
| R29 | Complaint **tracked as a ticket until the customer confirms everything works** | must | ticket can't close without customer confirmation; test |

## Scene 6 — The director's month-end

| ID | Requirement | Priority | Evidence |
|---|---|---|---|
| R30 | **Which installations made money, which lost money** | must | profit per job (revenue − parts − labour − expenses − warranty repairs); test |
| R31 | **What is still unfinished** (unfinished steps for customers) | must | "Unfinished" list by stage and age |
| R32 | Capture **advance payments, stock purchases, technician hours** | must | payments, purchase receipts, timesheets |
| R33 | **Invoices to send** | must | invoices with "to send" state |
| R34 | **Government subsidy paperwork** tracked | must | subsidy tracker per job |
| R35 | **Technicians to pay** | must | pay run from hours × rate |
| R36 | How the company is doing **today, this week and this month**, incl. **profit on each job** and **repairs still open** | must | dashboard period switch; test of period boundaries (IST) |
| R37 | **Share these numbers** when needed | must | read-only share link + CSV + print |

## Non-functional (from the team)

| ID | Requirement | Evidence |
|---|---|---|
| N1 | Specialised, non-generic design for rooftop solar | design direction doc; screenshot review |
| N2 | 3D and floating elements; dynamic | 3D landing story; 3D system viewer driven by the job's real parts |
| N3 | Responsive: phone, tablet, desktop | screenshot matrix 390/768/1440 |
| N4 | Production-ready: security, tests, deploy config, monitoring hooks | quality gates |
| N5 | Input validation everywhere, same rules on client and server | shared zod schemas; tests |

## Beyond the brief (wow)

| ID | Idea | Why it matters |
|---|---|---|
| W1 | Smart sizing: bill → recommended kW, capped by shadow-free roof area | Sales gives a confident answer on the first call |
| W2 | Cable lengths in the parts list come from the survey's cable distance | "Nobody should have to remember every small part" |
| W3 | PM Surya Ghar subsidy estimate, net price and payback in the quote | The brief's homeowner asks "under the subsidy" |
| W4 | Public quote link: customer reads and accepts the quote | "The customer says yes" without a phone call |
| W5 | Customer page: system, serials, warranty rulers, photos, signed certificate, raise and confirm complaints | "No doubt about what was installed" |
| W6 | QR warranty labels for every serial | Scan the inverter → warranty status |
| W7 | Camera barcode scanning on phones; USB scanners work as keyboards | Dispatch-day scanning |
| W8 | Live updates across screens (Postgres LISTEN/NOTIFY → SSE) | Warehouse and crew see jobs without phone calls |
| W9 | Warranty repair costs flow back into the original job's profit | Shows which installations really lost money |
| W10 | One-click private demo workspace | Judges can try everything safely |
| W11 | 3D "a week at SunPower" landing story | Explains the product using the brief's own scenes |
| W12 | 3D system viewer built from the job's actual parts | Dynamic 3D that carries data, not decoration |
| W13 | Crew schedule board with clash detection | 15 technicians, 40 jobs a month |
| W14 | Installation form keeps a local draft if the network drops on the roof | Rooftops have bad signal |
