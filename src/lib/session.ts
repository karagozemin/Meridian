import type { SessionState } from "../types.js";

/**
 * Classifies the trading regime of the underlying US equity at a given instant.
 *
 * Why this matters: "the US market is closed" is not one state. A tokenized stock
 * trading at 02:00 UTC has a live Blue Ocean overnight session behind it, while the
 * same token at 08:00 Saturday has nothing. Calling both "closed" would overstate our
 * case, so we distinguish them and label every comparison with the regime it was made in.
 *
 * All boundaries are Eastern Time and DST-aware via the IANA database.
 */

const ET = "America/New_York";

/**
 * US equity market holidays. Full closures only.
 *
 * Early-close days (typically 13:00 ET) are deliberately not modelled yet: treating a
 * half day as a normal session slightly overstates how fresh the reference is, which is
 * the safe direction to be wrong in for a display that is about to be corrected by the
 * data-age field anyway. Revisit if a half day lands near a demo.
 */
const MARKET_HOLIDAYS = new Set<string>([
  // 2026
  "2026-01-01", // New Year's Day
  "2026-01-19", // Martin Luther King Jr. Day
  "2026-02-16", // Washington's Birthday
  "2026-04-03", // Good Friday
  "2026-05-25", // Memorial Day
  "2026-06-19", // Juneteenth
  "2026-07-03", // Independence Day (observed)
  "2026-09-07", // Labor Day
  "2026-11-26", // Thanksgiving
  "2026-12-25", // Christmas
  // 2027
  "2027-01-01",
  "2027-01-18",
  "2027-02-15",
  "2027-03-26",
  "2027-05-31",
  "2027-06-18",
  "2027-07-05",
  "2027-09-06",
  "2027-11-25",
  "2027-12-24",
]);

interface EasternParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday. */
  weekday: number;
  isoDate: string;
}

const PART_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: ET,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
  hour12: false,
});

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function toEastern(instant: Date): EasternParts {
  const parts = PART_FORMAT.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";

  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  // Intl renders midnight as "24" in some ICU builds under hour12: false.
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  const weekday = WEEKDAY_INDEX[get("weekday")] ?? 0;

  const isoDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { year, month, day, hour, minute, weekday, isoDate };
}

const minutesOf = (p: EasternParts): number => p.hour * 60 + p.minute;

const REGULAR_OPEN = 9 * 60 + 30; // 09:30 ET
const REGULAR_CLOSE = 16 * 60; // 16:00 ET
const PRE_MARKET_OPEN = 4 * 60; // 04:00 ET
const POST_MARKET_CLOSE = 20 * 60; // 20:00 ET
const OVERNIGHT_OPEN = 20 * 60; // 20:00 ET, Blue Ocean
const OVERNIGHT_CLOSE = 4 * 60; // 04:00 ET next day

/**
 * Returns the session regime for `instant`, defaulting to now.
 *
 * Blue Ocean runs Sunday evening through Friday morning ET, so an overnight block that
 * starts on a weekday evening is live, and one that would start Friday or Saturday
 * evening is not.
 */
export function classifySession(instant: Date = new Date()): SessionState {
  const et = toEastern(instant);
  const mins = minutesOf(et);
  const easternTime = `${et.isoDate} ${String(et.hour).padStart(2, "0")}:${String(et.minute).padStart(2, "0")} ET`;
  const isHoliday = MARKET_HOLIDAYS.has(et.isoDate);
  const isWeekday = et.weekday >= 1 && et.weekday <= 5;

  const state = (regime: SessionState["regime"], detail: string): SessionState => ({
    regime,
    easternTime,
    isHoliday,
    detail,
  });

  if (isWeekday && !isHoliday && mins >= REGULAR_OPEN && mins < REGULAR_CLOSE) {
    return state("regular", "Regular US session (09:30-16:00 ET)");
  }

  if (isWeekday && !isHoliday && mins >= PRE_MARKET_OPEN && mins < REGULAR_OPEN) {
    return state("extended", "Pre-market extended session (04:00-09:30 ET)");
  }

  if (isWeekday && !isHoliday && mins >= REGULAR_CLOSE && mins < POST_MARKET_CLOSE) {
    return state("extended", "Post-market extended session (16:00-20:00 ET)");
  }

  // Blue Ocean overnight: evening block Sunday through Thursday.
  const eveningBlockIsLive = et.weekday >= 0 && et.weekday <= 4;
  if (mins >= OVERNIGHT_OPEN && eveningBlockIsLive) {
    return state("overnight", "Blue Ocean overnight session (opened 20:00 ET)");
  }

  // Morning half of an overnight block that started the previous evening.
  const morningBlockIsLive = et.weekday >= 1 && et.weekday <= 5;
  if (mins < OVERNIGHT_CLOSE && morningBlockIsLive) {
    return state("overnight", "Blue Ocean overnight session (closes 04:00 ET)");
  }

  if (isHoliday) return state("closed", "US market holiday — no live reference session");
  if (!isWeekday) return state("closed", "Weekend — no live reference session");
  return state("closed", "Outside all session windows");
}

/** True when no venue is quoting the underlying, so any reference price is necessarily stale. */
export function hasLiveReferenceSession(state: SessionState): boolean {
  return state.regime !== "closed";
}
