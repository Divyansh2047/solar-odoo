# Design direction — Arka

## Who, where, what

- **Who:** sales staff at a desk taking WhatsApp and phone enquiries; 15 technicians on hot, bright rooftops with phones and tablets; a warehouse hand with a barcode scanner and a truck waiting; a support person on a call during a monsoon storm; a director at month-end on a laptop (and sometimes a phone).
- **Feel words:** sunlit, engineered, field-ready, honest about money.
- **Domain metaphor:** the solar **module**: dark silicon cells separated by thin gaps inside an aluminium frame, lit by the sun. Secondary motifs: the **warranty ruler** (a 20-year scale with the "today" mark) and the **sun path** (the arc the sun draws across a roof, used once on the landing page).
- **Fastest task:** find a customer or a serial number while they're on the phone (≤ 2 seconds, from anywhere: `/` or Ctrl K).
- **What judges must remember:** *one serial number tells the whole story.* Type part of a serial and Arka shows the customer, their system drawn in 3D from the parts actually installed, and that unit's warranty ruler. Opening a ticket bills ₹0 when it's covered and invoices parts + labour when it isn't. The repair cost then shows up in that job's profit on the director's screen.

## Tokens

### Colour (light)
| Name | Hex | Role |
|---|---|---|
| Silicon | `#0E1A2B` | Ink, the KPI module, dark surfaces |
| Daylight | `#F2F5F8` | Page background (cool, not cream) |
| Sun | `#FFC233` | Primary action fill (with Silicon text), highlights, "energy" |
| Cell blue | `#1F4BA5` | Links, selection, focus ring, info |
| Feeder green | `#0B7F57` | Positive money, generation, "covered" |
| Fault red | `#C8372D` | Losses, faults, "expired", errors |

Supporting: surface `#FFFFFF`, frame (aluminium) `#C9D2DC`, line `#DDE3EA`, ink-2 `#3B4A5E`, ink-3 `#64748B`, warning `#A85D00`.

Dark ("night shift"): background `#0B1422` (navy, not black), surface `#111D2F`, ink `#E7EDF5`, Sun stays `#FFC233`, Cell blue `#86A8FF`, Feeder green `#3CCB8E`, Fault red `#FF7468`.

Semantic colour is never the only signal: profit carries a sign, warranty carries words ("Covered until 12 Mar 2028"), and statuses carry text.

### Type
- **Atkinson Hyperlegible Next** for everything. It was designed by the Braille Institute for low-vision readers, so it stays readable in glare on a rooftop. 400 for body, 600 for labels, 800 for display.
- **Atkinson Hyperlegible Mono** only for serial numbers, references (`JOB-0042`) and meter readings. 0/O and 1/l/I must never be confused when a technician types a serial.
- Scale: 12 · 13 · 14 · 15 (UI base) · 17 · 20 · 24 · 30 · 38 · 48 · 64 · 88 (landing display). Tabular figures in tables and money.
- Sentence case everywhere. No all-caps eyebrows. No "→" in buttons.

### Shape, space, depth, motion
- Radius by hierarchy: cells 3 px, chips 6 px, inputs/buttons 8 px, panels 12 px, sheets/dialogs 16 px.
- Space: 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64.
- Depth: hairline borders for structure; shadows only on things that float (popover, dialog, the mobile scan button, floating 3D labels).
- Motion: 160–280 ms, `cubic-bezier(.2,.8,.2,1)`. One orchestrated moment per surface: the landing scroll story, and in the app a cell lighting up when a job completes a stage. `prefers-reduced-motion` turns all of it into instant state changes.

## Layout

```
Desktop app
┌────────────┬─────────────────────────────────────────────────────┐
│ Arka       │ What needs a call today?        [Today|Week|Month] [+]│
│            ├─────────────────────────────────────────────────────┤
│ ● Enquiries│ attention strip: 3 not called in 2 h · 2 surveys late│
│ │ Surveys  │ ┌───────────────────────────────────────────────────┐│
│ │ Quotes   │ │ table / board (left aligned, numbers right)       ││
│ │ Jobs     │ │                                                   ││
│ │ Warehouse│ └───────────────────────────────────────────────────┘│
│ │ Install  │                         record drawer slides in ───▶ │
│ ● Service  │                                                     │
│ Money      │                                                     │
│ Reports    │                                                     │
└────────────┴─────────────────────────────────────────────────────┘
```
- **The journey rail** is the navigation: lifecycle stages hang on one wire (a PV string), each node with a live count ("4 need a call"). Back-office sections sit below the wire.
- Each screen opens with the question it answers, in plain words, at top left.
- **The KPI module** (dashboard): metrics are cells in one dark module with 2 px gaps and an aluminium frame. It's the single bold element of the dashboard; everything around it stays quiet.
- **The cell strip** (every job): eight small cells (Paid · Packed · Dispatched · Delivered · Installed · Signed · Subsidy · Closed) that fill with sun as stages complete; the next action sits right next to it.
- **The warranty ruler** (serials, customer page): a scale from delivery to 20 years, with each part's warranty as a band and today as a marker.
- Phone: bottom bar for field roles (Today · Scan · Search · Me); every table becomes cards with the 2–3 facts that matter; primary action within thumb reach.

```
Landing
┌───────────────────────────────────────────────────────────────┐
│ [3D rooftop at morning light, sun on its path]                │
│ From the first enquiry                                        │
│ to the twentieth year.          ┌ floating meter ┐            │
│ [Open the live demo] [Create…]  │ 2.41 kW now     │            │
├───────────────────────────────────────────────────────────────┤
│ Monday   The rooftop enquiry      (scene: form → roof marker) │
│ Tuesday  The survey               (compass, tilt, cable run)  │
│ Wednesday Getting the kit right   (parts float into a kit)    │
│ Thursday Dispatch and serials     (labels scanned, truck)     │
│ Friday   On the roof              (panels land, signature)    │
│ 18 months later  Rain             (fault → ticket → covered)  │
│ Month-end  The colony             (zoom out: roofs by profit) │
└───────────────────────────────────────────────────────────────┘
```
Left aligned throughout. The week is a real sequence, so the days are the structure.

## Principles
1. **The lifecycle is the spine.** Every record shows where it is and what unblocks it next, in the place the user is already looking.
2. **3D carries data.** The kit viewer draws the job's real panels, inverter and battery; the landing story replays the brief's own week. No floating blobs.
3. **Readable in sunlight.** AA contrast or better, 44 px targets, hyperlegible type, mono serials.
4. **Money is honest.** Profit and loss with signs and words, exact to the paisa, in Indian grouping (₹1,50,000).
5. **One bold thing per screen.** Everything else is quiet.

## Review against generic defaults (what I changed and why)
- *First idea:* a dark navy landing hero with a yellow accent. That's the "near-black + one bright accent" default. **Changed** to a daylight 3D rooftop at golden hour; dark stays a theme, not the identity.
- *First idea:* KPI cards in a row. That's the SaaS card kit. **Changed** to one dark "module" with cells and gaps, the shape of a solar panel.
- *First idea:* a mono font for small labels. That's template chrome. **Restricted** mono to serial numbers, references and meter readings, where it does a job.
- Rejected: purple/blue gradients, glass on everything, emoji headings, identical rounded cards with grey shadows, middle-dot meta strings, all-caps eyebrows.
