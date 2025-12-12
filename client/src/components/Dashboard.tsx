import { useEffect, useState } from 'react';
import { TankGauge } from './TankGauge';
import { PredictionCard } from './PredictionCard';
import { StatsCard } from './StatsCard';
import { GaugeReadingForm } from './GaugeReadingForm';
import { ConsumptionChart } from './ConsumptionChart';
import { HvacReportForm } from './HvacReportForm';
import { HvacReportsTable } from './HvacReportsTable';
import {
  getCurrentAnalysis,
  getPredictions,
  getWeather,
  getReadings,
  getHvacReports,
} from '../services/api';
import type {
  CurrentAnalysis,
  PredictionsResponse,
  WeatherData,
  GaugeReading,
  HvacReport,
} from '../types';

export function Dashboard() {
  const [analysis, setAnalysis] = useState<CurrentAnalysis | null>(null);
  const [predictions, setPredictions] = useState<PredictionsResponse | null>(null);
  const [weatherData, setWeatherData] = useState<WeatherData[]>([]);
  const [readings, setReadings] = useState<GaugeReading[]>([]);
  const [hvacReports, setHvacReports] = useState<HvacReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'gauge' | 'hvac'>('gauge');

  const loadData = async () => {
    try {
      setLoading(true);
      const [analysisData, predictionsData, weather, readingsData, hvacData] = await Promise.all([
        getCurrentAnalysis(),
        getPredictions(),
        getWeather(),
        getReadings(),
        getHvacReports(),
      ]);
      setAnalysis(analysisData);
      setPredictions(predictionsData);
      setWeatherData(weather);
      setReadings(readingsData);
      setHvacReports(hvacData);
      setError('');
    } catch (err) {
      setError('Failed to load data. Is the server running?');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-100 text-red-700 rounded-lg">
        {error}
        <button
          onClick={loadData}
          className="ml-4 px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">SpyD Home Heat</h1>
          <p className="text-gray-500">Fort Smith, NWT</p>
        </div>
        <div className="text-right text-sm text-gray-500">
          <div>Last reading: {analysis?.tank.reading_date} ({analysis?.tank.reading_percent}%)</div>
          {analysis?.tank.projection.days_since_reading ? (
            <div className="text-xs text-blue-600">
              Projected: -{analysis.tank.projection.consumption_since_reading}L over {analysis.tank.projection.days_since_reading} days ({analysis.tank.projection.hdd_since_reading} HDD)
            </div>
          ) : null}
        </div>
      </div>

      {/* Main Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Days Until Refill"
          value={analysis?.prediction.days_until_refill ?? '-'}
          subtitle={`Est. ${analysis?.prediction.estimated_refill_date}`}
        />
        <StatsCard
          title="Daily Consumption"
          value={`${analysis?.consumption.liters_per_day?.toFixed(1) ?? '-'} L`}
          subtitle="liters per day"
        />
        <StatsCard
          title="Current Efficiency"
          value={`${analysis?.efficiency.current_l_per_hdd?.toFixed(3) ?? analysis?.prediction.assumed_efficiency.toFixed(3)}`}
          subtitle="L/HDD"
        />
        <StatsCard
          title="Q1 2025 Baseline"
          value={analysis?.efficiency.baseline_q1_2025.toFixed(3) ?? '-'}
          subtitle="L/HDD (old windows)"
        />
      </div>

      {/* Tank and Predictions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <TankGauge
          percent={analysis?.tank.current_percent ?? 0}
          liters={analysis?.tank.current_liters ?? 0}
          capacity={analysis?.tank.capacity ?? 1000}
          isProjected={!!analysis?.tank.projection.days_since_reading}
          daysSinceReading={analysis?.tank.projection.days_since_reading}
        />

        {predictions && (
          <div className="lg:col-span-2">
            <PredictionCard data={predictions} />
          </div>
        )}
      </div>

      {/* Chart and Form with Tabs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <ConsumptionChart weatherData={weatherData.slice(0, 30)} />
        </div>

        <div>
          {/* Tab buttons */}
          <div className="flex mb-4 border-b">
            <button
              onClick={() => setActiveTab('gauge')}
              className={`px-4 py-2 font-medium text-sm ${activeTab === 'gauge'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
                }`}
            >
              Gauge Reading
            </button>
            <button
              onClick={() => setActiveTab('hvac')}
              className={`px-4 py-2 font-medium text-sm ${activeTab === 'hvac'
                  ? 'text-orange-600 border-b-2 border-orange-600'
                  : 'text-gray-500 hover:text-gray-700'
                }`}
            >
              HVAC Report
            </button>
          </div>

          {activeTab === 'gauge' ? (
            <GaugeReadingForm onSuccess={loadData} />
          ) : (
            <HvacReportForm onSuccess={loadData} />
          )}
        </div>
      </div>

      {/* HVAC Reports */}
      {hvacReports.length > 0 && (
        <HvacReportsTable reports={hvacReports} />
      )}

      {/* Recent Readings */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-700 mb-4">Recent Readings</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  Date
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  Gauge %
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  Est. Liters
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  L/day
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  L/HDD
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  Notes
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {readings.slice(0, 10).map((reading) => (
                <tr key={reading.id}>
                  <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                    {reading.date}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                    {reading.gauge_percent}%
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                    {reading.est_liters} L
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                    {reading.liters_per_day?.toFixed(2) ?? '-'}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                    {reading.liters_per_hdd?.toFixed(3) ?? '-'}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-500">
                    {reading.notes || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
