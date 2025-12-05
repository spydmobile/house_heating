import { useState } from 'react';
import { createReading } from '../services/api';

interface GaugeReadingFormProps {
  onSuccess: () => void;
}

export function GaugeReadingForm({ onSuccess }: GaugeReadingFormProps) {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [gaugePercent, setGaugePercent] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await createReading({
        date,
        gauge_percent: parseFloat(gaugePercent),
        notes: notes || undefined,
      });
      setGaugePercent('');
      setNotes('');
      onSuccess();
    } catch (err) {
      setError('Failed to save reading');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Quick select buttons for common gauge readings
  const quickSelects = [25, 50, 75, 87.5, 100];

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold text-gray-700 mb-4">Add Gauge Reading</h3>

      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-md">{error}</div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Date
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Gauge Reading (%)
          </label>
          <input
            type="number"
            step="0.1"
            min="0"
            max="100"
            value={gaugePercent}
            onChange={(e) => setGaugePercent(e.target.value)}
            placeholder="e.g., 75"
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            required
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {quickSelects.map((val) => (
              <button
                key={val}
                type="button"
                onClick={() => setGaugePercent(val.toString())}
                className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded-md"
              >
                {val}%
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Notes (optional)
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
          className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded-md transition-colors"
        >
          {loading ? 'Saving...' : 'Save Reading'}
        </button>
      </div>
    </form>
  );
}
