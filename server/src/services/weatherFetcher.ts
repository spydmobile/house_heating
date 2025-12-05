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

interface StationData {
  station_name?: string[];
  transport_canada_id?: string[];
  air_temperature_yesterday_high?: string[];
  air_temperature_yesterday_low?: string[];
}

/**
 * Fetch weather data from Environment Canada MSC Datamart
 * Data is available for the last 30 days
 *
 * URL pattern:
 * https://dd.weather.gc.ca/YYYYMMDD/WXO-DD/observations/xml/NT/yesterday/yesterday_nt_YYYYMMDD_e.xml
 *
 * The file dated YYYYMMDD contains yesterday's data (for YYYY-MM-(DD-1))
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

    const url = `${config.mscDatamartUrl}/${fileDateStr}/WXO-DD/observations/xml/NT/yesterday/yesterday_nt_${fileDateStr}_e.xml`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        // Try the /today/ path for recent data
        const todayUrl = `${config.mscDatamartUrl}/today/observations/xml/NT/yesterday/yesterday_nt_${fileDateStr}_e.xml`;
        const todayResponse = await fetch(todayUrl);

        if (!todayResponse.ok) {
          result.skipped++;
          result.errors.push(`${dataDate}: Data not available (${response.status})`);
          current.setDate(current.getDate() + 1);
          continue;
        }

        const xmlText = await todayResponse.text();
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
        } else {
          result.skipped++;
          result.errors.push(`${dataDate}: Fort Smith station not found in data`);
        }
      } else {
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
        } else {
          result.skipped++;
          result.errors.push(`${dataDate}: Fort Smith station not found in data`);
        }
      }
    } catch (error) {
      result.skipped++;
      result.errors.push(
        `${dataDate}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
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
    const parsed = await parseStringPromise(xmlText);

    // Navigate XML structure to find Fort Smith station
    const observations = parsed?.observations?.observation || [];

    for (const obs of observations) {
      const stationData = obs as StationData;

      // Look for Fort Smith by transport_canada_id (ZSM) or station name
      const stationId = stationData.transport_canada_id?.[0];
      const stationName = stationData.station_name?.[0]?.toLowerCase() || '';

      if (stationId === config.weatherStation || stationName.includes('fort smith')) {
        const highTemp = parseFloat(stationData.air_temperature_yesterday_high?.[0] || '');
        const lowTemp = parseFloat(stationData.air_temperature_yesterday_low?.[0] || '');

        if (!isNaN(highTemp) && !isNaN(lowTemp)) {
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
