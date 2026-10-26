import { describe, it, expect } from 'vitest';
import { resolveStation, FORT_SMITH_STATIONS } from './resolveStation';

/**
 * Resolves a Fort Smith station code to its Environment Canada climate-archive
 * STN_ID.
 *
 * This is the first piece of the climate-archive backfill, and it is first
 * because every later step depends on asking the archive for the right station.
 * The archive is keyed by a numeric STN_ID, not by the three-letter code, and
 * an unknown code resolved to "something plausible" would silently backfill a
 * year of weather from the wrong place.
 *
 * AGREED BASIS, settled 2026-10-15 and not to be re-derived:
 *
 *   ZSM = 41884, FORT SMITH CLIMATE — the series station, daily coverage
 *   2003-08-01 to 2026-10-13. This is the series the backfill is built on.
 *
 *   YSM = the airport, a DIFFERENT INSTRUMENT. Four named days come from it
 *   because ZSM has no record for them, each with provenance recorded:
 *   2026-01-12 (-13.4), 2026-02-19 (-27.6), 2026-03-11 (-21.1),
 *   2025-12-03 (-17.3).
 *
 *   2025-01-03 exists at NO Fort Smith station. It is recorded missing and
 *   NEVER interpolated.
 *
 * THE WHOLE POINT OF THROWING: a silent default here is the worst kind this
 * project can produce. The window-replacement ROI compares two quarters of
 * degree days; weather quietly sourced from an unintended station biases that
 * comparison, and nothing downstream would report it.
 */
describe('resolveStation', () => {
  it('resolves ZSM to the climate station STN_ID the series is built on', () => {
    expect(resolveStation('ZSM').stnId).toBe(41884);
  });

  it('names the station, so provenance can be recorded with the reading', () => {
    const station = resolveStation('ZSM');

    expect(station.code).toBe('ZSM');
    expect(station.name).toMatch(/fort smith/i);
  });

  it('resolves YSM, the airport, as a distinct station', () => {
    const ysm = resolveStation('YSM');

    expect(ysm.code).toBe('YSM');
    expect(ysm.stnId).not.toBe(resolveStation('ZSM').stnId);
  });

  /**
   * VERIFIED AGAINST THE LIVE ARCHIVE 2026-10-23. Two active stations carry
   * TC_IDENTIFIER = YSM — 53119 and 54218 — at identical coordinates, and both
   * return the four secondary-station days with exactly the recorded values. The
   * three-letter code is therefore a LABEL, not a unique archive key.
   *
   * 53119 is pinned because its daily record (2014-11-06 onward) strictly
   * contains 54218's (2018-10-29 onward). This test exists so the choice
   * cannot be changed casually: swapping it silently narrows the usable range
   * by four years.
   */
  it('pins YSM to 53119, the longer of the two stations sharing that code', () => {
    expect(resolveStation('YSM').stnId).toBe(53119);
  });

  describe('an unknown code THROWS rather than defaulting', () => {
    /**
     * The test Franco approved on 2026-10-15. A default here would mean a
     * backfill that looks successful and silently sources a year of weather
     * from the wrong instrument.
     */
    it('throws, naming the code it was given', () => {
      expect(() => resolveStation('XXX')).toThrowError(/XXX/);
    });

    it('names the codes it does know, so the error is actionable', () => {
      expect(() => resolveStation('XXX')).toThrowError(/ZSM/);
    });

    it.each(['', '  ', 'zsm ', 'YZF', '41884'])(
      'throws on %o rather than guessing',
      (code) => {
        expect(() => resolveStation(code)).toThrowError();
      },
    );

    /**
     * Never returns a sentinel. A caller that forgot to check would otherwise
     * fetch from STN_ID 0 or undefined and get an empty result that reads as
     * "no data for this period" — which is exactly the confusion the backfill
     * exists to remove.
     */
    it('never returns a value for an unknown code', () => {
      let returned: unknown = 'not assigned';

      try {
        returned = resolveStation('XXX');
      } catch {
        // expected
      }

      expect(returned).toBe('not assigned');
    });
  });

  /**
   * Case is normalised because the code arrives from config, a CLI argument
   * and a database column. Rejecting 'zsm' would be pedantry; accepting
   * 'zsm ' with a trailing space silently would not — hence the explicit
   * whitespace cases above.
   */
  it('accepts a lower-case code', () => {
    expect(resolveStation('zsm').stnId).toBe(41884);
  });

  describe('the registry itself', () => {
    it('lists both Fort Smith stations and no others', () => {
      expect(Object.keys(FORT_SMITH_STATIONS).sort()).toEqual(['YSM', 'ZSM']);
    });

    it('gives every station a distinct STN_ID', () => {
      const ids = Object.values(FORT_SMITH_STATIONS).map((s) => s.stnId);

      expect(new Set(ids).size).toBe(ids.length);
    });

    /**
     * ZSM is marked as the preferred series so later steps do not have to
     * re-derive which station the backfill is built on — and so a day taken
     * from YSM is visibly an exception rather than an equal alternative.
     */
    it('marks ZSM as the preferred series and YSM as the secondary', () => {
      expect(FORT_SMITH_STATIONS.ZSM.preferred).toBe(true);
      expect(FORT_SMITH_STATIONS.YSM.preferred).toBe(false);
    });
  });
});
