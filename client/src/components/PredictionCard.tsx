import type { Prediction } from '../types';

interface PredictionCardProps {
  predictions: Prediction[];
  currentLiters: number;
  efficiency: number;
}

export function PredictionCard({ predictions, currentLiters, efficiency }: PredictionCardProps) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold text-gray-700 mb-4">Refill Predictions</h3>

      <div className="mb-4 text-sm text-gray-600">
        <p>Current tank: <span className="font-medium">{currentLiters} L</span></p>
        <p>Using efficiency: <span className="font-medium">{efficiency} L/HDD</span></p>
      </div>

      <div className="space-y-3">
        {predictions.map((pred, index) => (
          <div
            key={pred.scenario}
            className={`p-3 rounded-lg ${
              index === 0 ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50'
            }`}
          >
            <div className="flex justify-between items-start">
              <div>
                <div className="font-medium text-gray-800">{pred.scenario}</div>
                <div className="text-sm text-gray-600">
                  {pred.hdd_per_day} HDD/day = {pred.daily_fuel_liters} L/day
                </div>
              </div>
              <div className="text-right">
                <div className="font-bold text-gray-800">{pred.days_until_refill} days</div>
                <div className="text-sm text-gray-600">{pred.estimated_refill_date}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
