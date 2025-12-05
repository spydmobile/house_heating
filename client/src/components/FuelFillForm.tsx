import { useState } from 'react';
import { createFill } from '../services/api';

interface FuelFillFormProps {
  onSuccess: () => void;
}

export function FuelFillForm({ onSuccess }: FuelFillFormProps) {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [gaugeBefore, setGaugeBefore] = useState('');
  const [litersAdded, setLitersAdded] = useState('');
  const [pricePerLiter, setPricePerLiter] = useState('1.46');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await createFill({
        date,
        gauge_percent_before: parseFloat(gaugeBefore),
        liters_added: parseFloat(litersAdded),
        price_per_liter: parseFloat(pricePerLiter),
        notes: notes || undefined,
      });
      // Reset form but keep price (likely similar next time)
      setGaugeBefore('');
      setLitersAdded('');
      setNotes('');
      onSuccess();
    } catch (err) {
      setError('Failed to save fill');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Calculate estimated cost
  const estimatedCost = () => {
    const liters = parseFloat(litersAdded);
    const price = parseFloat(pricePerLiter);
    if (isNaN(liters) || isNaN(price)) return null;

    const gross = liters * price;
    const discount = liters * 0.02;
    const subtotal = gross - discount;
    const gst = subtotal * 0.05;
    return (subtotal + gst).toFixed(2);
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold text-gray-700 mb-4">Record Fuel Fill</h3>

      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-md">{error}</div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Fill Date
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
            Gauge Before Fill (%)
          </label>
          <input
            type="number"
            step="0.1"
            min="0"
            max="100"
            value={gaugeBefore}
            onChange={(e) => setGaugeBefore(e.target.value)}
            placeholder="e.g., 25"
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Liters Added
          </label>
          <input
            type="number"
            step="0.1"
            min="0"
            value={litersAdded}
            onChange={(e) => setLitersAdded(e.target.value)}
            placeholder="e.g., 500"
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Price per Liter ($)
          </label>
          <input
            type="number"
            step="0.001"
            min="0"
            value={pricePerLiter}
            onChange={(e) => setPricePerLiter(e.target.value)}
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            required
          />
        </div>

        {estimatedCost() && (
          <div className="p-3 bg-blue-50 rounded-md">
            <div className="text-sm text-gray-600">Estimated Total (with 2c/L discount + GST)</div>
            <div className="text-xl font-bold text-gray-800">${estimatedCost()}</div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Notes (optional)
          </label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g., Winter fill"
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 px-4 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-medium rounded-md transition-colors"
        >
          {loading ? 'Saving...' : 'Record Fill'}
        </button>
      </div>
    </form>
  );
}
