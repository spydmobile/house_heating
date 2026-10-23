/**
 * Fort Smith weather stations in the Environment Canada climate archive.
 *
 * The archive is keyed by a numeric STN_ID, not by the three-letter code, so
 * every request has to resolve one to the other. THIS RESOLUTION THROWS ON AN
 * UNKNOWN CODE, and that is the point rather than strictness for its own sake:
 * a default here would backfill a year of weather from an unintended
 * instrument, the run would report success, and nothing downstream would
 * notice. The window-replacement ROI compares two quarters of degree days —
 * weather quietly sourced from the wrong station biases exactly that
 * comparison.
 *
 * AGREED BASIS, settled 2026-10-15, recorded so it is not re-derived:
 *
 *   ZSM — FORT SMITH CLIMATE, STN_ID 41884. The series the backfill is built
 *   on; daily coverage 2003-08-01 to 2026-10-13.
 *
 *   YSM — the AIRPORT. A different instrument. Four days come from it because
 *   ZSM has no record for them, each carrying recorded provenance:
 *   2026-01-12 (-13.4), 2026-02-19 (-27.6), 2026-03-11 (-21.1),
 *   2025-12-03 (-17.3).
 *
 * VERIFIED AGAINST THE LIVE ARCHIVE 2026-10-23, and it corrected me twice:
 *
 *   1. I had written YSM's STN_ID as 1706 from memory. It is not — that number
 *      was fabricated. Caught before commit only because the four days above
 *      are a known-positive control.
 *   2. THE THREE-LETTER CODE IS NOT A UNIQUE KEY. Two active stations carry
 *      TC_IDENTIFIER = YSM — 53119 and 54218 — at identical coordinates and
 *      elevation, and BOTH return all four days with exactly the recorded
 *      values. So the code is a LABEL and STN_ID is the key.
 *
 *      53119 is chosen because its daily record is longer and strictly
 *      contains the other's: 2014-11-06 onward, against 54218's 2018-10-29.
 *
 *   Positive control on the method: ZSM (41884) returns NULL for all four of
 *   those days, which is why they were taken from the airport in the first
 *   place. The check could distinguish a hit from a miss.
 *
 *   2025-01-03 exists at NO Fort Smith station. Recorded missing, never
 *   interpolated.
 */

export interface ClimateStation {
  code: string;
  name: string;
  /** Environment Canada climate-archive station id. */
  stnId: number;
  /**
   * True for the series the backfill is built on. Marked here so later steps
   * need not re-derive it, and so a day taken from the other station is
   * visibly an exception rather than an equal alternative.
   */
  preferred: boolean;
}

export const FORT_SMITH_STATIONS: Record<string, ClimateStation> = {
  ZSM: {
    code: 'ZSM',
    name: 'FORT SMITH CLIMATE',
    stnId: 41884,
    preferred: true,
  },
  YSM: {
    code: 'YSM',
    name: 'FORT SMITH A',
    // The airport. A distinct instrument from ZSM, used only for the four
    // named days ZSM does not cover, always with provenance recorded.
    //
    // 53119 rather than 54218: both are live, both carry TC_IDENTIFIER YSM at
    // the same coordinates, and both return the four days identically — but
    // 53119's daily record starts 2014-11-06 and 54218's only 2018-10-29, so
    // 53119 strictly contains it.
    stnId: 53119,
    preferred: false,
  },
};

export function resolveStation(code: string): ClimateStation {
  // Case is normalised because the code arrives from config, a CLI argument
  // and a database column. Surrounding whitespace is NOT trimmed away
  // silently — 'ZSM ' in a config file is a typo worth surfacing, not
  // something to quietly accept.
  const station =
    typeof code === 'string' && code === code.trim()
      ? FORT_SMITH_STATIONS[code.toUpperCase()]
      : undefined;

  if (!station) {
    throw new Error(
      `Unknown weather station code ${JSON.stringify(code)}. ` +
        `Known codes: ${Object.keys(FORT_SMITH_STATIONS).join(', ')}. ` +
        'Refusing to default — backfilling from an unintended station would ' +
        'bias the degree-day comparison and report success while doing it.',
    );
  }

  return station;
}
