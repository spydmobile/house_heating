export interface FuelFill {
  id: number;
  date: string;
  gauge_percent_before: number;
  liters_added: number;
  liters_before_fill: number;
  price_per_liter: number;
  discount: number;
  gst: number;
  total_cost: number;
  notes: string | null;
  created_at: string;
}

export interface GaugeReading {
  id: number;
  date: string;
  gauge_percent: number;
  notes: string | null;
  created_at: string;
  // Calculated fields
  est_liters: number;
  days_since_last: number | null;
  liters_used: number | null;
  liters_per_day: number | null;
  hdd_period: number | null;
  liters_per_hdd: number | null;
}

export interface WeatherData {
  id: number;
  date: string;
  max_temp: number | null;
  min_temp: number | null;
  mean_temp: number | null;
  hdd: number | null;
  source: string;
  created_at: string;
}

export interface CurrentAnalysis {
  tank: {
    current_liters: number;
    current_percent: number;
    capacity: number;
    reading_date: string;
  };
  consumption: {
    since_fill_liters: number | null;
    days_since_fill: number | null;
    liters_per_day: number | null;
  };
  efficiency: {
    current_l_per_hdd: number | null;
    baseline_q1_2025: number;
  };
  prediction: {
    days_until_refill: number;
    estimated_refill_date: string;
    assumed_hdd_per_day: number;
    assumed_efficiency: number;
  };
}

export interface Prediction {
  scenario: string;
  hdd_per_day: number;
  daily_fuel_liters: number;
  days_until_refill: number;
  estimated_refill_date: string;
}

export interface PredictionsResponse {
  current_tank: {
    liters: number;
    percent: number;
    as_of: string;
  };
  efficiency_used: number;
  predictions: Prediction[];
  typical_hdd_by_month: Record<number, number>;
}

export interface CostAnalysis {
  totals: {
    liters: number;
    cost: number;
    fills: number;
  };
  averages: {
    price_per_liter: number;
    cost_per_hdd: number | null;
  };
  annual_projections: {
    assumed_annual_hdd: number;
    assumed_price_per_liter: number;
    scenarios: Array<{
      efficiency: number;
      annual_liters: number;
      annual_cost: number;
    }>;
  };
  recent_fills: FuelFill[];
}

export interface HvacReport {
  id: number;
  year: number;
  month: number;
  total_runtime_hours: number;
  avg_cycle_minutes: number | null;
  avg_outdoor_temp: number | null;
  avg_indoor_temp: number | null;
  avg_setpoint: number | null;
  notes: string | null;
  created_at: string;
  // Enriched fields
  fuel_liters?: number | null;
  liters_per_runtime_hour?: number | null;
}

export interface HvacEfficiencyAnalysis {
  period: string;
  year: number;
  month: number;
  runtime_hours: number;
  avg_cycle_min: number | null;
  avg_outdoor_temp: number | null;
  fuel_liters: number | null;
  total_hdd: number | null;
  liters_per_hour: number | null;
  liters_per_hdd: number | null;
}
