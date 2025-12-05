// Fetch 7-day weather forecast from Open-Meteo API
// Fort Smith, NWT coordinates: 60.009, -111.883

const FORT_SMITH_LAT = 60.009;
const FORT_SMITH_LON = -111.883;
const BASE_TEMP = 18; // HDD base temperature

export interface ForecastDay {
  date: string;
  max_temp: number;
  min_temp: number;
  mean_temp: number;
  hdd: number;
}

export interface ForecastResponse {
  location: string;
  fetched_at: string;
  forecast: ForecastDay[];
  total_hdd_7day: number;
  avg_hdd_per_day: number;
}

export async function fetchForecast(): Promise<ForecastResponse> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${FORT_SMITH_LAT}&longitude=${FORT_SMITH_LON}&daily=temperature_2m_max,temperature_2m_min&timezone=America/Yellowknife&forecast_days=7`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch forecast: ${response.status}`);
  }

  const data = await response.json();

  const forecast: ForecastDay[] = data.daily.time.map((date: string, i: number) => {
    const max = data.daily.temperature_2m_max[i];
    const min = data.daily.temperature_2m_min[i];
    const mean = (max + min) / 2;
    const hdd = Math.max(0, BASE_TEMP - mean);

    return {
      date,
      max_temp: Math.round(max * 10) / 10,
      min_temp: Math.round(min * 10) / 10,
      mean_temp: Math.round(mean * 10) / 10,
      hdd: Math.round(hdd * 10) / 10,
    };
  });

  const totalHDD = forecast.reduce((sum, day) => sum + day.hdd, 0);

  return {
    location: 'Fort Smith, NWT',
    fetched_at: new Date().toISOString(),
    forecast,
    total_hdd_7day: Math.round(totalHDD * 10) / 10,
    avg_hdd_per_day: Math.round((totalHDD / forecast.length) * 10) / 10,
  };
}
