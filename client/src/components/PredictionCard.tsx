import { format, parseISO } from 'date-fns';
import type { PredictionsResponse } from '../types';

interface PredictionCardProps {
  data: PredictionsResponse;
}

export function PredictionCard({ data }: PredictionCardProps) {
  const { current_tank, efficiency, forecast_based_prediction, forecast, scenarios } = data;

  return (
    <div className="space-y-6">
      {/* Main Prediction */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-800 rounded-lg shadow-lg p-6 text-white">
        <h3 className="text-lg font-medium opacity-90 mb-2">Forecast-Based Prediction</h3>
        <div className="flex items-baseline gap-2">
          <span className="text-5xl font-bold">{forecast_based_prediction.days_until_refill}</span>
          <span className="text-xl opacity-90">days until refill</span>
        </div>
        <div className="mt-2 text-blue-100">
          Estimated date: <span className="font-semibold">{format(parseISO(forecast_based_prediction.estimated_refill_date), 'MMM d, yyyy')}</span>
        </div>
        <div className="mt-4 pt-4 border-t border-blue-400/30 grid grid-cols-3 gap-4 text-sm">
          <div>
            <div className="opacity-75">Current Level</div>
            <div className="font-semibold">{current_tank.liters}L ({current_tank.percent}%)</div>
          </div>
          <div>
            <div className="opacity-75">Efficiency</div>
            <div className="font-semibold">{efficiency.used} L/HDD</div>
          </div>
          <div>
            <div className="opacity-75">Refill At</div>
            <div className="font-semibold">{forecast_based_prediction.refill_threshold_percent}% (200L)</div>
          </div>
        </div>
        {efficiency.measured && (
          <div className="mt-2 text-xs text-blue-200">
            Using measured efficiency from recent consumption
          </div>
        )}
      </div>

      {/* 7-Day Forecast */}
      {forecast && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-700 mb-4">
            7-Day Weather Forecast
            <span className="text-sm font-normal text-gray-500 ml-2">
              (avg {forecast.avg_hdd_per_day} HDD/day)
            </span>
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2 font-medium">Date</th>
                  <th className="pb-2 font-medium text-right">High</th>
                  <th className="pb-2 font-medium text-right">Low</th>
                  <th className="pb-2 font-medium text-right">HDD</th>
                  <th className="pb-2 font-medium text-right">Fuel</th>
                </tr>
              </thead>
              <tbody>
                {forecast.days.map((day, i) => {
                  const projection = forecast_based_prediction.daily_projection[i];
                  const isToday = i === 0;
                  const isCold = day.mean_temp < -25;
                  return (
                    <tr
                      key={day.date}
                      className={`border-b border-gray-100 ${isToday ? 'bg-blue-50' : ''} ${isCold ? 'text-blue-700' : ''}`}
                    >
                      <td className="py-2 font-medium">
                        {isToday ? 'Today' : format(parseISO(day.date), 'EEE, MMM d')}
                      </td>
                      <td className="py-2 text-right">{day.max_temp}°C</td>
                      <td className="py-2 text-right">{day.min_temp}°C</td>
                      <td className="py-2 text-right font-medium">{day.hdd}</td>
                      <td className="py-2 text-right text-orange-600">
                        {projection ? `${projection.fuel_used}L` : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tank Projection */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-700 mb-4">14-Day Tank Projection</h3>
        <div className="space-y-2">
          {forecast_based_prediction.daily_projection.map((day, i) => {
            const isForecast = i < 7;
            const isLow = day.remaining_percent < 40;
            const isCritical = day.remaining_percent < 25;
            return (
              <div key={day.date} className="flex items-center gap-3">
                <div className="w-20 text-sm text-gray-600">
                  {i === 0 ? 'Today' : format(parseISO(day.date), 'MMM d')}
                </div>
                <div className="flex-1">
                  <div className="h-6 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        isCritical ? 'bg-red-500' :
                        isLow ? 'bg-yellow-500' :
                        'bg-green-500'
                      }`}
                      style={{ width: `${day.remaining_percent}%` }}
                    />
                  </div>
                </div>
                <div className="w-20 text-right text-sm">
                  <span className={`font-medium ${isCritical ? 'text-red-600' : isLow ? 'text-yellow-600' : 'text-gray-700'}`}>
                    {day.remaining_liters}L
                  </span>
                </div>
                <div className="w-16 text-right text-xs text-gray-500">
                  {isForecast ? '(forecast)' : '(typical)'}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Scenarios */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-700 mb-4">Weather Scenarios</h3>
        <div className="grid grid-cols-2 gap-3">
          {scenarios.map((scenario, index) => (
            <div
              key={scenario.scenario}
              className={`p-4 rounded-lg ${
                index === 0 ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50'
              }`}
            >
              <div className="font-medium text-gray-800">{scenario.scenario}</div>
              <div className="text-sm text-gray-600 mt-1">
                {scenario.hdd_per_day} HDD/day = {scenario.daily_fuel_liters} L/day
              </div>
              <div className="mt-2 flex justify-between items-baseline">
                <span className="text-2xl font-bold text-gray-800">{scenario.days_until_refill}</span>
                <span className="text-sm text-gray-600">
                  {format(parseISO(scenario.estimated_refill_date), 'MMM d')}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
