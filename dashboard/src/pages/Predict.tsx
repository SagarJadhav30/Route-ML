import { useState } from "react";

interface PredictResult {
  ml: {
    eta_minutes: number;
    confidence_low: number;
    confidence_high: number;
    feature_importances: Record<string, number>;
  };
  formula: {
    eta_minutes: number;
    average_speed_kmh: number;
    traffic_multiplier: number;
    weather_multiplier: number;
  };
}

const PRESETS = [
  { label: "Short city trip", origin_lat: 40.7128, origin_lng: -74.006, dest_lat: 40.7306, dest_lng: -73.9866, distance_km: 5 },
  { label: "Cross-town", origin_lat: 40.7580, origin_lng: -73.9855, dest_lat: 40.6892, dest_lng: -74.0445, distance_km: 15 },
  { label: "Long haul", origin_lat: 40.7128, origin_lng: -74.006, dest_lat: 41.0534, dest_lng: -73.5387, distance_km: 55 },
];

export default function Predict() {
  const [form, setForm] = useState({
    origin_lat: 40.7128,
    origin_lng: -74.006,
    dest_lat: 40.7306,
    dest_lng: -73.9866,
    hour_of_day: new Date().getHours(),
    day_of_week: (new Date().getDay() + 6) % 7, // JS Sun=0, we want Mon=0
    weather: "clear",
    distance_km: 5,
  });

  const [result, setResult] = useState<PredictResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (field: string, value: string | number) =>
    setForm((f) => ({ ...f, [field]: value }));

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(await res.text());
      setResult(await res.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const applyPreset = (i: number) => {
    const p = PRESETS[i];
    setForm((f) => ({ ...f, ...p }));
  };

  const inputCls =
    "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-blue-600 focus:border-transparent outline-none";
  const labelCls = "block text-xs font-medium text-gray-400 mb-1";

  return (
    <div className="grid lg:grid-cols-2 gap-8">
      {/* Form */}
      <div>
        <h1 className="text-2xl font-bold mb-1">Predict ETA</h1>
        <p className="text-sm text-gray-500 mb-6">
          Enter route details to get an ML-powered delivery time estimate with confidence interval.
        </p>

        {/* Presets */}
        <div className="flex gap-2 mb-6">
          {PRESETS.map((p, i) => (
            <button
              key={i}
              onClick={() => applyPreset(i)}
              className="text-xs px-3 py-1.5 rounded-full bg-gray-800 border border-gray-700 hover:border-blue-500 transition-colors text-gray-300"
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Origin Latitude</label>
              <input type="number" step="any" className={inputCls} value={form.origin_lat}
                onChange={(e) => update("origin_lat", parseFloat(e.target.value) || 0)} />
            </div>
            <div>
              <label className={labelCls}>Origin Longitude</label>
              <input type="number" step="any" className={inputCls} value={form.origin_lng}
                onChange={(e) => update("origin_lng", parseFloat(e.target.value) || 0)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Destination Latitude</label>
              <input type="number" step="any" className={inputCls} value={form.dest_lat}
                onChange={(e) => update("dest_lat", parseFloat(e.target.value) || 0)} />
            </div>
            <div>
              <label className={labelCls}>Destination Longitude</label>
              <input type="number" step="any" className={inputCls} value={form.dest_lng}
                onChange={(e) => update("dest_lng", parseFloat(e.target.value) || 0)} />
            </div>
          </div>

          <div>
            <label className={labelCls}>Distance (km)</label>
            <input type="number" step="0.1" min="0.1" className={inputCls} value={form.distance_km}
              onChange={(e) => update("distance_km", parseFloat(e.target.value) || 0)} />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Hour (0-23)</label>
              <input type="number" min="0" max="23" className={inputCls} value={form.hour_of_day}
                onChange={(e) => update("hour_of_day", parseInt(e.target.value) || 0)} />
            </div>
            <div>
              <label className={labelCls}>Day (0=Mon, 6=Sun)</label>
              <input type="number" min="0" max="6" className={inputCls} value={form.day_of_week}
                onChange={(e) => update("day_of_week", parseInt(e.target.value) || 0)} />
            </div>
            <div>
              <label className={labelCls}>Weather</label>
              <select className={inputCls} value={form.weather}
                onChange={(e) => update("weather", e.target.value)}>
                <option value="clear">Clear</option>
                <option value="rain">Rain</option>
                <option value="snow">Snow</option>
              </select>
            </div>
          </div>

          <button
            onClick={submit}
            disabled={loading}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 rounded-lg font-medium text-sm transition-colors"
          >
            {loading ? "Predicting..." : "Get ETA Prediction"}
          </button>

          {error && (
            <div className="bg-red-900/30 border border-red-800 rounded-lg p-3 text-sm text-red-300">
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      <div>
        {result ? (
          <div className="space-y-6">
            {/* ML Prediction Card */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-2 h-2 rounded-full bg-blue-500" />
                <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
                  ML Prediction
                </h2>
              </div>
              <div className="text-5xl font-bold text-white mb-2">
                {result.ml.eta_minutes.toFixed(1)}
                <span className="text-lg text-gray-500 ml-2">min</span>
              </div>
              {/* Confidence bar */}
              <div className="mt-4">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>{result.ml.confidence_low.toFixed(1)} min</span>
                  <span className="text-blue-400">80% confidence interval</span>
                  <span>{result.ml.confidence_high.toFixed(1)} min</span>
                </div>
                <div className="h-3 bg-gray-800 rounded-full overflow-hidden relative">
                  {(() => {
                    const low = result.ml.confidence_low;
                    const high = result.ml.confidence_high;
                    const eta = result.ml.eta_minutes;
                    const range = high * 1.2;
                    const leftPct = (low / range) * 100;
                    const widthPct = ((high - low) / range) * 100;
                    const etaPct = (eta / range) * 100;
                    return (
                      <>
                        <div
                          className="absolute h-full bg-blue-600/40 rounded-full"
                          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                        />
                        <div
                          className="absolute h-full w-1 bg-blue-400 rounded-full"
                          style={{ left: `${etaPct}%` }}
                        />
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* Feature importances */}
              <div className="mt-6">
                <h3 className="text-xs font-medium text-gray-500 mb-3 uppercase tracking-wider">
                  Feature Importance
                </h3>
                <div className="space-y-2">
                  {Object.entries(result.ml.feature_importances)
                    .sort(([, a], [, b]) => b - a)
                    .map(([name, val]) => (
                      <div key={name} className="flex items-center gap-3">
                        <span className="text-xs text-gray-400 w-32 truncate">{name}</span>
                        <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full"
                            style={{ width: `${val * 100}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-500 w-12 text-right">
                          {(val * 100).toFixed(1)}%
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            </div>

            {/* Formula Comparison Card */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-2 h-2 rounded-full bg-amber-500" />
                <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
                  Formula Baseline
                </h2>
              </div>
              <div className="text-4xl font-bold text-gray-300 mb-2">
                {result.formula.eta_minutes.toFixed(1)}
                <span className="text-lg text-gray-500 ml-2">min</span>
              </div>
              <div className="grid grid-cols-3 gap-4 mt-4 text-center">
                <div>
                  <div className="text-lg font-semibold text-gray-300">
                    {result.formula.average_speed_kmh}
                  </div>
                  <div className="text-xs text-gray-500">km/h base</div>
                </div>
                <div>
                  <div className="text-lg font-semibold text-gray-300">
                    {result.formula.traffic_multiplier}x
                  </div>
                  <div className="text-xs text-gray-500">traffic</div>
                </div>
                <div>
                  <div className="text-lg font-semibold text-gray-300">
                    {result.formula.weather_multiplier}x
                  </div>
                  <div className="text-xs text-gray-500">weather</div>
                </div>
              </div>

              {/* Delta */}
              {(() => {
                const diff = result.ml.eta_minutes - result.formula.eta_minutes;
                const pct = ((diff / result.formula.eta_minutes) * 100).toFixed(1);
                const color = Math.abs(diff) < 1 ? "text-gray-400" : diff > 0 ? "text-red-400" : "text-green-400";
                return (
                  <div className={`mt-4 text-sm ${color}`}>
                    ML predicts {Math.abs(diff).toFixed(1)} min {diff > 0 ? "slower" : "faster"} than formula ({pct}%)
                  </div>
                );
              })()}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-600">
            <div className="text-center">
              <div className="text-6xl mb-4 opacity-30">&#128752;</div>
              <p className="text-sm">Enter route details and hit predict</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
