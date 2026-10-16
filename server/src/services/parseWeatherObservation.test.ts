import { describe, it, expect } from 'vitest';
import { parseWeatherObservation } from './parseWeatherObservation';

/**
 * Parsing one Environment Canada "yesterday" XML file for a Fort Smith
 * observation.
 *
 * Extracted from `weatherFetcher.ts`, where it was tangled with an HTTP call
 * and a synchronous SQLite insert and could not be tested at all.
 *
 * THE DEFECT THIS EXTRACTION EXPOSES: the original matched station `ZSM` OR
 * `YSM` OR any station whose name contained "fort smith", and then wrote every
 * row with `source: 'auto'`. So which station a day's reading came from was
 * discarded at the moment it was known.
 *
 * ZSM (Fort Smith Climate) and YSM (the airport) are different instruments.
 * Mixing them without a record is exactly what the climate-archive backfill
 * plan exists to prevent — four days there are sourced from YSM and each one
 * carries recorded provenance. So the parser now RETURNS the station it
 * matched, and the caller is obliged to keep it.
 */

function xml(elements: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<om:ObservationCollection xmlns:om="http://www.opengis.net/om/1.0">
  <om:member>
    <om:Observation>
      <om:metadata>
        <set>
          <identification-elements>
            ${elements}
          </identification-elements>
        </set>
      </om:metadata>
      <om:result>
        <elements>
          <element name="air_temperature_yesterday_high" value="-9.8"/>
          <element name="air_temperature_yesterday_low" value="-17.0"/>
        </elements>
      </om:result>
    </om:Observation>
  </om:member>
</om:ObservationCollection>`;
}

const zsm = xml(`
  <element name="station_name" value="FORT SMITH CLIMATE"/>
  <element name="transport_canada_id" value="ZSM"/>
`);

const ysm = xml(`
  <element name="station_name" value="FORT SMITH A"/>
  <element name="transport_canada_id" value="YSM"/>
`);

const elsewhere = xml(`
  <element name="station_name" value="YELLOWKNIFE A"/>
  <element name="transport_canada_id" value="YZF"/>
`);

describe('parseWeatherObservation', () => {
  it('reads the high and low for the requested date', async () => {
    const observation = await parseWeatherObservation(zsm, '2026-01-12');

    expect(observation).not.toBeNull();
    expect(observation?.date).toBe('2026-01-12');
    expect(observation?.maxTemp).toBe(-9.8);
    expect(observation?.minTemp).toBe(-17);
  });

  it('derives the mean temperature and HDD at base 18', async () => {
    const observation = await parseWeatherObservation(zsm, '2026-01-12');

    // mean = (-17 + -9.8) / 2 = -13.4 ; HDD = 18 - (-13.4) = 31.4
    expect(observation?.meanTemp).toBe(-13.4);
    expect(observation?.hdd).toBe(31.4);
  });

  /**
   * THE POINT OF THE EXTRACTION. Which station the reading came from must
   * survive, because ZSM and YSM are different instruments and a silent mix
   * biases any before/after comparison built on the series.
   */
  it('reports the station it matched', async () => {
    expect((await parseWeatherObservation(zsm, '2026-01-12'))?.station).toBe('ZSM');
    expect((await parseWeatherObservation(ysm, '2026-01-12'))?.station).toBe('YSM');
  });

  it('ignores stations that are not Fort Smith', async () => {
    expect(await parseWeatherObservation(elsewhere, '2026-01-12')).toBeNull();
  });

  it('returns null when the file has no observations at all', async () => {
    const empty = `<?xml version="1.0"?><om:ObservationCollection xmlns:om="http://www.opengis.net/om/1.0"/>`;

    expect(await parseWeatherObservation(empty, '2026-01-12')).toBeNull();
  });

  /**
   * Malformed XML must return null, not throw. A single bad file in a range
   * fetch should skip that day and be reported, not abort the whole run.
   */
  it('returns null for malformed XML rather than throwing', async () => {
    expect(await parseWeatherObservation('<not-xml', '2026-01-12')).toBeNull();
  });

  /**
   * A reading present but unparseable is not a reading. The original guarded
   * with `if (name === '...' && value)`, so a value of "0" — 0 °C, an ordinary
   * day here — was treated as absent. The guard is on parseability now.
   */
  it('accepts a temperature of 0 rather than treating it as missing', async () => {
    const atZero = xml(`
      <element name="station_name" value="FORT SMITH CLIMATE"/>
      <element name="transport_canada_id" value="ZSM"/>
    `).replace('value="-9.8"', 'value="0"').replace('value="-17.0"', 'value="0"');

    const observation = await parseWeatherObservation(atZero, '2026-05-20');

    expect(observation?.maxTemp).toBe(0);
    expect(observation?.minTemp).toBe(0);
    expect(observation?.meanTemp).toBe(0);
    expect(observation?.hdd).toBe(18);
  });

  it('returns null when a temperature is missing entirely', async () => {
    const noTemps = zsm.replace(
      /<element name="air_temperature_yesterday_low" value="[^"]*"\/>/,
      '',
    );

    expect(await parseWeatherObservation(noTemps, '2026-01-12')).toBeNull();
  });

  it('returns null when a temperature is present but not a number', async () => {
    const bad = zsm.replace('value="-9.8"', 'value="M"');

    expect(await parseWeatherObservation(bad, '2026-01-12')).toBeNull();
  });

  /**
   * ZSM is preferred when a file carries both, because it is the climate
   * station and the series the backfill plan is built on. Without a preference
   * the answer would depend on the order Environment Canada happened to emit
   * them in.
   */
  it('prefers ZSM over YSM when a file contains both', async () => {
    const both = `<?xml version="1.0" encoding="UTF-8"?>
<om:ObservationCollection xmlns:om="http://www.opengis.net/om/1.0">
  <om:member><om:Observation>
    <om:metadata><set><identification-elements>
      <element name="station_name" value="FORT SMITH A"/>
      <element name="transport_canada_id" value="YSM"/>
    </identification-elements></set></om:metadata>
    <om:result><elements>
      <element name="air_temperature_yesterday_high" value="-5.0"/>
      <element name="air_temperature_yesterday_low" value="-15.0"/>
    </elements></om:result>
  </om:Observation></om:member>
  <om:member><om:Observation>
    <om:metadata><set><identification-elements>
      <element name="station_name" value="FORT SMITH CLIMATE"/>
      <element name="transport_canada_id" value="ZSM"/>
    </identification-elements></set></om:metadata>
    <om:result><elements>
      <element name="air_temperature_yesterday_high" value="-9.8"/>
      <element name="air_temperature_yesterday_low" value="-17.0"/>
    </elements></om:result>
  </om:Observation></om:member>
</om:ObservationCollection>`;

    const observation = await parseWeatherObservation(both, '2026-01-12');

    expect(observation?.station).toBe('ZSM');
    expect(observation?.maxTemp).toBe(-9.8);
  });
});
