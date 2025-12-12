import { parseStringPromise } from 'xml2js';
import { getDb } from '../db/schema.js';
import { calculateMeanTemp, calculateHDD } from './calculations.js';
import { config } from '../config.js';

interface WeatherFetchResult {
  fetched: number;
  skipped: number;
  errors: string[];
  data: Array<{
    date: string;
    max_temp: number;
    min_temp: number;
    mean_temp: number;
    hdd: number;
  }>;
}

/**
 * Fetch weather data from Environment Canada MSC Datamart
 *
 * URL pattern for today's file:
 * https://dd.weather.gc.ca/today/observations/xml/NT/yesterday/yesterday_nt_YYYYMMDD_e.xml
 *
 * The file contains yesterday's data for all NT stations
 */
export async function fetchWeatherData(fromDate: string, toDate: string): Promise<WeatherFetchResult> {
  const result: WeatherFetchResult = {
    fetched: 0,
    skipped: 0,
    errors: [],
    data: [],
  };

  const db = getDb();
  const insertStmt = db.prepare(
    `INSERT OR REPLACE INTO weather_data (date, max_temp, min_temp, mean_temp, hdd, source)
     VALUES (?, ?, ?, ?, ?, 'auto')`
  );

  // Parse dates
  const start = new Date(fromDate);
  const end = new Date(toDate);

  // Iterate through each day we want data for
  const current = new Date(start);
  while (current <= end) {
    const dataDate = current.toISOString().split('T')[0];

    // The file that contains data for `dataDate` is dated the NEXT day
    // (yesterday's file contains the previous day's data)
    const fileDate = new Date(current);
    fileDate.setDate(fileDate.getDate() + 1);
    const fileDateStr = fileDate.toISOString().split('T')[0].replace(/-/g, '');

    // Try /today/ path first (for recent data), then dated path
    const urls = [
      `${config.mscDatamartUrl}/today/observations/xml/NT/yesterday/yesterday_nt_${fileDateStr}_e.xml`,
      `${config.mscDatamartUrl}/${fileDateStr}/WXO-DD/observations/xml/NT/yesterday/yesterday_nt_${fileDateStr}_e.xml`,
    ];

    let success = false;
    for (const url of urls) {
      try {
        const response = await fetch(url);
        if (!response.ok) continue;

        const xmlText = await response.text();
        const weatherData = await parseWeatherXml(xmlText, dataDate);

        if (weatherData) {
          insertStmt.run(
            dataDate,
            weatherData.max_temp,
            weatherData.min_temp,
            weatherData.mean_temp,
            weatherData.hdd
          );
          result.fetched++;
          result.data.push(weatherData);
          success = true;
          break;
        }
      } catch (error) {
        // Try next URL
        continue;
      }
    }

    if (!success) {
      result.skipped++;
      result.errors.push(`${dataDate}: Fort Smith station not found in data`);
    }

    current.setDate(current.getDate() + 1);
  }

  return result;
}

async function parseWeatherXml(
  xmlText: string,
  dataDate: string
): Promise<{ date: string; max_temp: number; min_temp: number; mean_temp: number; hdd: number } | null> {
  try {
    const parsed = await parseStringPromise(xmlText, {
      explicitArray: false,
      ignoreAttrs: false,
      tagNameProcessors: [(name) => name.replace(/^.*:/, '')], // Strip namespace prefixes
    });

    // Navigate the om:ObservationCollection structure
    const collection = parsed?.ObservationCollection;
    if (!collection) return null;

    // Get all members (observations)
    let members = collection.member;
    if (!members) return null;
    if (!Array.isArray(members)) members = [members];

    for (const member of members) {
      const observation = member.Observation;
      if (!observation) continue;

      const metadata = observation.metadata?.set;
      if (!metadata) continue;

      // Get identification elements
      const idElements = metadata['identification-elements']?.element;
      if (!idElements) continue;

      const idArray = Array.isArray(idElements) ? idElements : [idElements];

      // Find station name and transport_canada_id
      let stationName = '';
      let stationId = '';

      for (const el of idArray) {
        const name = el.$?.name;
        const value = el.$?.value;
        if (name === 'station_name') stationName = value?.toLowerCase() || '';
        if (name === 'transport_canada_id') stationId = value || '';
      }

      // Check if this is Fort Smith (ZSM or YSM for airport)
      if (stationId !== config.weatherStation &&
          stationId !== 'YSM' &&
          !stationName.includes('fort smith')) {
        continue;
      }

      // Get result elements (temperatures)
      const resultElements = observation.result?.elements?.element;
      if (!resultElements) continue;

      const resultArray = Array.isArray(resultElements) ? resultElements : [resultElements];

      let highTemp: number | null = null;
      let lowTemp: number | null = null;

      for (const el of resultArray) {
        const name = el.$?.name;
        const value = el.$?.value;
        if (name === 'air_temperature_yesterday_high' && value) {
          highTemp = parseFloat(value);
        }
        if (name === 'air_temperature_yesterday_low' && value) {
          lowTemp = parseFloat(value);
        }
      }

      if (highTemp !== null && lowTemp !== null && !isNaN(highTemp) && !isNaN(lowTemp)) {
        const meanTemp = calculateMeanTemp(lowTemp, highTemp);
        const hdd = calculateHDD(meanTemp);

        return {
          date: dataDate,
          max_temp: highTemp,
          min_temp: lowTemp,
          mean_temp: Math.round(meanTemp * 100) / 100,
          hdd: Math.round(hdd * 100) / 100,
        };
      }
    }

    return null;
  } catch (error) {
    console.error('XML parse error:', error);
    return null;
  }
}

/**
 * Fetch yesterday's weather data (convenience function)
 */
export async function fetchYesterdayWeather(): Promise<WeatherFetchResult> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split('T')[0];
  return fetchWeatherData(dateStr, dateStr);
}
