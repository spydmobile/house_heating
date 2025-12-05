interface TankGaugeProps {
  percent: number;
  liters: number;
  capacity: number;
}

export function TankGauge({ percent, liters, capacity }: TankGaugeProps) {
  // Determine color based on level
  const getColor = () => {
    if (percent <= 20) return 'bg-red-500';
    if (percent <= 40) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold text-gray-700 mb-4">Tank Level</h3>

      <div className="flex items-center gap-6">
        {/* Visual Tank */}
        <div className="relative w-24 h-40 border-4 border-gray-400 rounded-b-lg bg-gray-100">
          {/* Fuel level */}
          <div
            className={`absolute bottom-0 left-0 right-0 ${getColor()} rounded-b transition-all duration-500`}
            style={{ height: `${percent}%` }}
          />

          {/* Level markers */}
          <div className="absolute inset-0 flex flex-col justify-between py-1">
            {[100, 75, 50, 25, 0].map((mark) => (
              <div key={mark} className="flex items-center">
                <div className="w-2 h-px bg-gray-400" />
                <span className="text-xs text-gray-500 ml-1">{mark}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div className="flex-1">
          <div className="text-4xl font-bold text-gray-800">{percent}%</div>
          <div className="text-xl text-gray-600">{liters} L</div>
          <div className="text-sm text-gray-500">of {capacity} L capacity</div>

          {percent <= 25 && (
            <div className="mt-3 px-3 py-2 bg-red-100 text-red-700 rounded-md text-sm">
              Low fuel - consider refilling soon
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
