import type { HvacReport } from '../types';

interface HvacReportsTableProps {
  reports: HvacReport[];
}

const MONTHS = [
  '', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

export function HvacReportsTable({ reports }: HvacReportsTableProps) {
  if (reports.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-700 mb-4">HVAC Reports</h3>
        <p className="text-gray-500">No HVAC reports yet. Add your first one!</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold text-gray-700 mb-4">HVAC Reports</h3>
      <p className="text-sm text-gray-500 mb-4">
        Monthly runtime data from Liberty thermostat
      </p>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                Period
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                Runtime
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                Avg Cycle
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                Outdoor °C
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                Fuel Used
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                L/hr
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                Notes
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {reports.map((report) => (
              <tr key={report.id}>
                <td className="px-4 py-2 whitespace-nowrap text-sm font-medium text-gray-900">
                  {MONTHS[report.month]} {report.year}
                </td>
                <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                  {report.total_runtime_hours}h
                </td>
                <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                  {report.avg_cycle_minutes ? `${report.avg_cycle_minutes}m` : '-'}
                </td>
                <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                  {report.avg_outdoor_temp ?? '-'}
                </td>
                <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                  {report.fuel_liters ? `${report.fuel_liters.toFixed(0)}L` : '-'}
                </td>
                <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                  {report.liters_per_runtime_hour
                    ? report.liters_per_runtime_hour.toFixed(2)
                    : '-'}
                </td>
                <td className="px-4 py-2 text-sm text-gray-500 max-w-xs truncate">
                  {report.notes || '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {reports.length > 0 && reports[0].liters_per_runtime_hour && (
        <div className="mt-4 p-3 bg-orange-50 rounded-md">
          <div className="text-sm text-gray-600">
            Latest efficiency: <span className="font-bold text-orange-700">
              {reports[0].liters_per_runtime_hour.toFixed(2)} L/runtime-hour
            </span>
          </div>
          <div className="text-xs text-gray-500 mt-1">
            Lower is better - indicates furnace efficiency
          </div>
        </div>
      )}
    </div>
  );
}
