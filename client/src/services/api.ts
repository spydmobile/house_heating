import axios from 'axios';
import type {
  FuelFill,
  GaugeReading,
  WeatherData,
  CurrentAnalysis,
  PredictionsResponse,
  CostAnalysis,
  HvacReport,
  HvacEfficiencyAnalysis,
} from '../types';

const API_BASE = 'http://localhost:3001/api';

const api = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Fuel Fills
export const getFills = () => api.get<FuelFill[]>('/fills').then((res) => res.data);

export const createFill = (data: {
  date: string;
  gauge_percent_before: number;
  liters_added: number;
  price_per_liter: number;
  notes?: string;
}) => api.post<FuelFill>('/fills', data).then((res) => res.data);

export const updateFill = (id: number, data: Partial<FuelFill>) =>
  api.put<FuelFill>(`/fills/${id}`, data).then((res) => res.data);

export const deleteFill = (id: number) => api.delete(`/fills/${id}`);

// Gauge Readings
export const getReadings = () =>
  api.get<GaugeReading[]>('/readings').then((res) => res.data);

export const createReading = (data: {
  date: string;
  gauge_percent: number;
  notes?: string;
}) => api.post<GaugeReading>('/readings', data).then((res) => res.data);

export const updateReading = (id: number, data: Partial<GaugeReading>) =>
  api.put<GaugeReading>(`/readings/${id}`, data).then((res) => res.data);

export const deleteReading = (id: number) => api.delete(`/readings/${id}`);

// Weather
export const getWeather = (from?: string, to?: string) => {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  return api
    .get<WeatherData[]>(`/weather?${params}`)
    .then((res) => res.data);
};

export const createWeather = (data: {
  date: string;
  max_temp: number;
  min_temp: number;
}) => api.post<WeatherData>('/weather', data).then((res) => res.data);

export const fetchWeatherFromEC = (from: string, to: string) =>
  api
    .post<{
      fetched: number;
      skipped: number;
      errors: string[];
      data: WeatherData[];
    }>('/weather/fetch', { from, to })
    .then((res) => res.data);

// Analysis
export const getCurrentAnalysis = () =>
  api.get<CurrentAnalysis>('/analysis/current').then((res) => res.data);

export const getPredictions = () =>
  api.get<PredictionsResponse>('/analysis/predictions').then((res) => res.data);

export const getCostAnalysis = () =>
  api.get<CostAnalysis>('/analysis/costs').then((res) => res.data);

export const getEfficiency = (params: { from?: string; to?: string; period?: string }) => {
  const searchParams = new URLSearchParams();
  if (params.from) searchParams.set('from', params.from);
  if (params.to) searchParams.set('to', params.to);
  if (params.period) searchParams.set('period', params.period);
  return api.get(`/analysis/efficiency?${searchParams}`).then((res) => res.data);
};

// HVAC Reports
export const getHvacReports = () =>
  api.get<HvacReport[]>('/hvac').then((res) => res.data);

export const createHvacReport = (data: {
  year: number;
  month: number;
  total_runtime_hours: number;
  avg_cycle_minutes?: number;
  avg_outdoor_temp?: number;
  avg_indoor_temp?: number;
  avg_setpoint?: number;
  notes?: string;
}) => api.post<HvacReport>('/hvac', data).then((res) => res.data);

export const getHvacEfficiencyAnalysis = () =>
  api.get<HvacEfficiencyAnalysis[]>('/hvac/analysis/efficiency').then((res) => res.data);
