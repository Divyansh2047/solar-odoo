import type { ReactNode, RefObject } from 'react';
import {
  CABLE_RUN_M,
  COUNTS,
  CUSTOMER,
  DATES,
  ENQUIRY,
  PAYBACK_YEARS,
  QUOTE,
  QUOTE_NET,
  SERIALS,
  SIGNED_AT,
  SURVEY,
  TEST_HOUR,
  TEST_KW,
  TICKET,
  clock,
  rupees,
} from './story';

/* The landing page's words: the seven days and the feature module. Numbers come from story.ts. */

/** Seven cells, the day's one lit: where this scene sits in the week. */
export function WeekStrip({ at }: { at: number }) {
  return (
    <span className="lp-strip" aria-hidden="true">
      {Array.from({ length: 7 }, (_, i) => (
        <span key={i} className={i < at ? 'done' : i === at ? 'now' : undefined} />
      ))}
    </span>
  );
}

export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="lp-facts">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function WarrantyRuler() {
  return (
    <div className="lp-ruler" role="img" aria-label={`Warranty from delivery on ${DATES.thu}: inverter covered until ${DATES.inverterUntil}, panels until ${DATES.panelsUntil}.`}>
      <div className="lp-ruler-row">
        <span className="lp-ruler-name">Inverter</span>
        <span className="lp-ruler-track">
          <span className="lp-band sun" style={{ width: '10%' }} />
        </span>
        <span className="lp-ruler-end">{DATES.inverterUntil}</span>
      </div>
      <div className="lp-ruler-row">
        <span className="lp-ruler-name">Panels</span>
        <span className="lp-ruler-track">
          <span className="lp-band good" style={{ width: '100%' }} />
        </span>
        <span className="lp-ruler-end">{DATES.panelsUntil}</span>
      </div>
      <div className="lp-ruler-row lp-ruler-scale" aria-hidden="true">
        <span />
        <span className="lp-ruler-ticks">
          {[0, 5, 10, 15, 20].map((y) => (
            <span key={y}>{y === 0 ? 'Delivery' : `${y} y`}</span>
          ))}
        </span>
        <span className="lp-ruler-end lp-ghost">{DATES.panelsUntil}</span>
      </div>
    </div>
  );
}

export function Signature({ pathRef }: { pathRef: RefObject<SVGPathElement | null> }) {
  return (
    <figure className="lp-sign">
      <svg viewBox="0 0 220 60" aria-hidden="true">
        <path
          ref={pathRef}
          pathLength={1}
          d="M8 42c10-22 18-30 22-24s-8 26-4 26 14-30 20-30-6 26 0 26 10-16 14-16-2 14 4 14 8-12 12-12 0 10 6 10c6 0 10-20 16-20s-4 22 2 22 12-24 18-24-6 22 0 22 10-10 14-10 2 8 8 8 14-6 30-8"
        />
      </svg>
      <figcaption>
        Signed by {CUSTOMER} at {SIGNED_AT}
      </figcaption>
    </figure>
  );
}

export const DAYS: { day: string; date: string; title: string; body: string; facts?: [string, ReactNode][]; extra?: 'ruler' | 'sign' | 'legend' }[] = [
  {
    day: 'Monday',
    date: DATES.mon,
    title: 'The rooftop enquiry',
    body: `At ${ENQUIRY.at}, ${CUSTOMER} asks on SunPower’s website for ${ENQUIRY.need}. It lands in the sales list the same second, with a clock on the first call. An enquiry can be closed with a reason, never deleted.`,
    facts: [
      ['Reference', <span className="mono">{ENQUIRY.ref}</span>],
      ['First call', `${ENQUIRY.firstCallMin} minutes after it arrived`],
    ],
  },
  {
    day: 'Tuesday',
    date: DATES.tue,
    title: 'The survey',
    body: `${SURVEY.by}, a technician, measures the roof on his phone: which way it faces, the tilt for the stands and how far the cable runs to the meter. Sales can send a quote only once his survey is approved.`,
    facts: [
      ['Roof faces', `${SURVEY.facing}°, south`],
      ['Tilt', `${SURVEY.tilt}°`],
      ['Cable run', `${CABLE_RUN_M} m`],
      ['Shadow-free area', `${SURVEY.shadowFree} m²`],
    ],
  },
  {
    day: 'Wednesday',
    date: DATES.wed,
    title: 'Getting the kit right',
    body: `The quote starts from the ${QUOTE.template} template. The exact parts list follows by itself: panels, inverter, stands, switch boxes, wires and safety earthing. The cable length comes from Tuesday’s ${CABLE_RUN_M} m run, so nobody guesses.`,
    facts: [
      ['Price', rupees(QUOTE.price)],
      ['Subsidy', `${rupees(-QUOTE.subsidy)} (PM Surya Ghar)`],
      ['Anita pays', rupees(QUOTE_NET)],
      ['Payback', `about ${PAYBACK_YEARS} years`],
    ],
  },
  {
    day: 'Thursday',
    date: DATES.thu,
    title: 'Dispatch and serial numbers',
    body: 'Before the truck leaves, the warehouse scans every inverter and panel. One missing scan and the dispatch won’t go through. When the delivery is marked done, each serial’s warranty starts by itself.',
    facts: [['Inverter serial', <span className="mono">{SERIALS.inverter}</span>]],
    extra: 'ruler',
  },
  {
    day: 'Friday',
    date: DATES.fri,
    title: 'On the roof',
    body: `The crew fixes the stands, lands the six panels, finishes the earthing and tests the output on site. ${CUSTOMER.split(' ')[0]} signs on the tablet, and her certificate lists every serial on her roof.`,
    facts: [['Power test', `${TEST_KW.toFixed(2)} kW at ${clock(TEST_HOUR)}`]],
    extra: 'sign',
  },
  {
    day: 'Eighteen months later',
    date: DATES.rain,
    title: 'Rain',
    body: `Monsoon. The inverter shows ${TICKET.code}, an ${TICKET.fault}. Support types 08812, the end of the serial, and finds ${CUSTOMER.split(' ')[0]}’s system in seconds. It is under warranty, so the repair costs her nothing. The ticket stays open until she confirms it works.`,
    facts: [
      ['Covered until', DATES.inverterUntil],
      ['Ticket', <span className="mono">{TICKET.ref}</span>],
      ['Customer pays', rupees(0)],
    ],
  },
  {
    day: 'Month-end',
    date: '',
    title: 'The director’s view',
    body: `Pull back and every job this month is on one screen: ${COUNTS.profit} made money, ${COUNTS.loss} lost money and ${COUNTS.unfinished} are still unfinished. Warranty repairs are charged back to the job they came from, so a loss is a real loss.`,
    facts: [['Profit on finished jobs', rupees(COUNTS.net)]],
    extra: 'legend',
  },
];

export const FEATURES = [
  { title: 'Enquiries that can’t vanish', body: 'Website, WhatsApp and phone enquiries land in one list. Closing one needs a reason; nothing is deleted.' },
  { title: 'Roof surveys with photos', body: 'Direction, tilt, shadow-free area and cable run, measured on the roof from a phone.' },
  { title: 'Quotes from templates with subsidy and payback', body: 'Pick 1 to 5 kW, on-grid or off-grid. Subsidy, net price and payback fill themselves in.' },
  { title: 'Pick lists and serial scanning', body: 'The warehouse gets the exact parts list. Nothing leaves until every serial is scanned.' },
  { title: 'Crew schedule without phone calls', body: 'A job lands on the crew board once the advance is paid. Double bookings are refused.' },
  { title: 'Installation sign-off on a phone with signature', body: 'Times, photos, power test and the homeowner’s signature, even on a weak signal.' },
  { title: 'Warranty that starts itself', body: 'Delivery starts every serial’s clock: 2 years for inverters and batteries, 20 for panels.', lit: true },
  { title: 'Service tickets billed (or not) automatically', body: 'Covered repairs bill ₹0. Out of warranty, parts and labour are invoiced on their own.' },
  { title: 'Profit per job, subsidy paperwork, technician pay', body: 'Repairs flow back into each job’s profit. Hours become the pay run.' },
];
