import { useState } from 'react';
import { createHvacReport } from '../services/api';

interface HvacReportFormProps {
  onSuccess: () => void;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export function HvacReportForm({ onSuccess }: HvacReportFormProps) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [runtimeHours, setRuntimeHours] = useState('');
  const [avgCycle, setAvgCycle] = useState('');
  const [outdoorTemp, setOutdoorTemp] = useState('');
  const [indoorTemp, setIndoorTemp] = useState('');
  const [setpoint, setSetpoint] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await createHvacReport({
        year,
        month,
        total_runtime_hours: parseFloat(runtimeHours),
        avg_cycle_minutes: avgCycle ? parseFloat(avgCycle) : undefined,
        avg_outdoor_temp: outdoorTemp ? parseFloat(outdoorTemp) : undefined,
        avg_indoor_temp: indoorTemp ? parseFloat(indoorTemp) : undefined,
        avg_setpoint: setpoint ? parseFloat(setpoint) : undefined,
        notes: notes || undefined,
      });
      // Reset form
      setRuntimeHours('');
      setAvgCycle('');
      setOutdoorTemp('');
      setIndoorTemp('');
      setSetpoint('');
      setNotes('');
      onSuccess();
    } catch (err) {
      setError('Failed to save report');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold text-gray-700 mb-4">Add HVAC Report</h3>
      <p className="text-sm text-gray-500 mb-4">
        Enter data from your monthly Liberty thermostat report
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-md">{error}</div>
      )}

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Year
            </label>
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value))}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Month
            </label>
            <select
              value={month}
              onChange={(e) => setMonth(parseInt(e.target.value))}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              required
            >
              {MONTHS.map((name, i) => (
                <option key={i} value={i + 1}>{name}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Total Runtime (hours) *
          </label>
          <input
            type="number"
            step="0.1"
            value={runtimeHours}
            onChange={(e) => setRuntimeHours(e.target.value)}
            placeholder="e.g., 204"
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Avg Cycle (minutes)
            </label>
            <input
              type="number"
              step="1"
              value={avgCycle}
              onChange={(e) => setAvgCycle(e.target.value)}
              placeholder="e.g., 48"
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Avg Outdoor Temp (°C)
            </label>
            <input
              type="number"
              step="0.1"
              value={outdoorTemp}
              onChange={(e) => setOutdoorTemp(e.target.value)}
              placeholder="e.g., -4.5"
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Avg Indoor Temp (°C)
            </label>
            <input
              type="number"
              step="0.1"
              value={indoorTemp}
              onChange={(e) => setIndoorTemp(e.target.value)}
              placeholder="e.g., 21.5"
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Avg Setpoint (°C)
            </label>
            <input
              type="number"
              step="0.1"
              value={setpoint}
              onChange={(e) => setSetpoint(e.target.value)}
              placeholder="e.g., 21.5"
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Notes
          </label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any observations..."
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 px-4 bg-orange-600 hover:bg-orange-700 disabled:bg-orange-400 text-white font-medium rounded-md transition-colors"
        >
          {loading ? 'Saving...' : 'Save HVAC Report'}
        </button>
      </div>
    </form>
  );
}
