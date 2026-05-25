import { useState, useEffect } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from "recharts";

interface CompareResult {
  input: any;
  ml: { eta_minutes: number; confidence_low: number; confidence_high: number };
  formula: { eta_minutes: number };
  delta: { difference_minutes: number; difference_percent: number; ml_predicts_faster: boolean };
}

// Generate a batch of test scenarios to compare ML vs formula
function generateScenarios() {
  const scenarios: any[] = [];
  const weathers = ["clear", "rain", "snow"];
  const distances = [2, 5, 10, 20, 35, 50, 75];
  const hours = [3, 8, 12, 17, 21];

  for (const dist of distances) {
    for (const hour of hours) {
      for (const weather of weathers) {
        scenarios.push({
          origin_lat: 40.7128,
          origin_lng: -74.006,
          dest_lat: 40.7306,
          dest_lng: -73.9866,
          distance_km: dist,
          hour_of_day: hour,
          day_of_week: 2, // Wednesday
          weather,
        });
      }
    }
  }
  return scenarios;
}

export default function Compare() {
  const [results, setResults] = useState<CompareResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runComparison = async () => {
    setLoading(true);
    setError(null);
    const scenarios = generateScenarios();
    const batch: CompareResult[] = [];

    try {
      // Fetch in parallel, 10 at a time
      for (let i = 0; i < scenarios.length; i += 10) {
        const chunk = scenarios.slice(i, i + 10);
        const promises = chunk.map((s) => {
          const params = new URLSearchParams({
            origin_lat: s.origin_lat.toString(),
            origin_lng: s.origin_lng.toString(),
            dest_lat: s.dest_lat.toString(),
            dest_lng: s.dest_lng.toString(),
            distance_km: s.distance_km.toString(),
            hour_of_day: s.hour_of_day.toString(),
            day_of_week: s.day_of_week.toString(),
            weather: s.weather,
          });
          return fetch(`/api/compare?${params}`).then((r) => r.json());
        });
        const res = await Promise.all(promises);
        batch.push(...res);
      }
      setResults(batch);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Scatter data: ML ETA vs Formula ETA
  const scatterData = results.map((r) => ({
    formula: parseFloat(r.formula.eta_minutes.toFixed(1)),
    ml: parseFloat(r.ml.eta_minutes.toFixed(1)),
    weather: r.input.weather,
  }));

  // Error distribution
  const errorBuckets = [
    { label: "<1 min", count: 0, color: "#22c55e" },
    { label: "1-3 min", count: 0, color: "#3b82f6" },
    { label: "3-5 min", count: 0, color: "#f59e0b" },
    { label: "5-10 min", count: 0, color: "#ef4444" },
    { label: ">10 min", count: 0, color: "#dc2626" },
  ];
  results.forEach((r) => {
    const diff = Math.abs(r.delta.difference_minutes);
    if (diff < 1) errorBuckets[0].count++;
    else if (diff < 3) errorBuckets[1].count++;
    else if (diff < 5) errorBuckets[2].count++;
    else if (diff < 10) errorBuckets[3].count++;
    else errorBuckets[4].count++;
  });

  // Summary stats
  const avgDiff = results.length
    ? results.reduce((s, r) => s + Math.abs(r.delta.difference_minutes), 0) / results.length
    : 0;
  const maxDiff = results.length
    ? Math.max(...results.map((r) => Math.abs(r.delta.difference_minutes)))
    : 0;
  const mlFasterPct = results.length
    ? (results.filter((r) => r.delta.ml_predicts_faster).length / results.length) * 100
    : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">ML vs Formula Comparison</h1>
          <p className="text-sm text-gray-500">
            Run {generateScenarios().length} test scenarios across distances, hours, and weather conditions.
          </p>
        </div>
        <button
          onClick={runComparison}
          disabled={loading}
          className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 rounded-lg font-medium text-sm transition-colors"
        >
          {loading ? "Running..." : results.length ? "Re-run Comparison" : "Run Comparison"}
        </button>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded-lg p-3 text-sm text-red-300 mb-6">
          {error}
        </div>
      )}

      {results.length > 0 && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                Avg Difference
              </div>
              <div className="text-3xl font-bold text-white">
                {avgDiff.toFixed(1)}
                <span className="text-sm text-gray-500 ml-1">min</span>
              </div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                Max Difference
              </div>
              <div className="text-3xl font-bold text-white">
                {maxDiff.toFixed(1)}
                <span className="text-sm text-gray-500 ml-1">min</span>
              </div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                ML Predicts Faster
              </div>
              <div className="text-3xl font-bold text-white">
                {mlFasterPct.toFixed(0)}
                <span className="text-sm text-gray-500 ml-1">%</span>
              </div>
            </div>
          </div>

          {/* Charts */}
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Scatter: ML vs Formula */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h3 className="text-sm font-semibold text-gray-400 mb-4 uppercase tracking-wider">
                ML ETA vs Formula ETA
              </h3>
              <p className="text-xs text-gray-600 mb-4">
                Points on the diagonal = agreement. Deviation = where ML learned non-linear patterns formulas miss.
              </p>
              <ResponsiveContainer width="100%" height={350}>
                <ScatterChart margin={{ top: 10, right: 10, bottom: 20, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis
                    dataKey="formula"
                    name="Formula ETA"
                    unit=" min"
                    stroke="#6b7280"
                    fontSize={11}
                    label={{ value: "Formula (min)", position: "bottom", fill: "#6b7280", fontSize: 11 }}
                  />
                  <YAxis
                    dataKey="ml"
                    name="ML ETA"
                    unit=" min"
                    stroke="#6b7280"
                    fontSize={11}
                    label={{ value: "ML (min)", angle: -90, position: "insideLeft", fill: "#6b7280", fontSize: 11 }}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151", borderRadius: "8px" }}
                    labelStyle={{ color: "#9ca3af" }}
                  />
                  <Legend />
                  <Scatter
                    name="Clear"
                    data={scatterData.filter((d) => d.weather === "clear")}
                    fill="#3b82f6"
                    fillOpacity={0.7}
                  />
                  <Scatter
                    name="Rain"
                    data={scatterData.filter((d) => d.weather === "rain")}
                    fill="#f59e0b"
                    fillOpacity={0.7}
                  />
                  <Scatter
                    name="Snow"
                    data={scatterData.filter((d) => d.weather === "snow")}
                    fill="#ef4444"
                    fillOpacity={0.7}
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </div>

            {/* Bar: Error distribution */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h3 className="text-sm font-semibold text-gray-400 mb-4 uppercase tracking-wider">
                Prediction Difference Distribution
              </h3>
              <p className="text-xs text-gray-600 mb-4">
                How much do ML and formula disagree? Smaller buckets = more agreement.
              </p>
              <ResponsiveContainer width="100%" height={350}>
                <BarChart data={errorBuckets} margin={{ top: 10, right: 10, bottom: 20, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="label" stroke="#6b7280" fontSize={11} />
                  <YAxis stroke="#6b7280" fontSize={11} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#111827", border: "1px solid #374151", borderRadius: "8px" }}
                  />
                  <Bar dataKey="count" name="Scenarios" radius={[4, 4, 0, 0]}>
                    {errorBuckets.map((entry, idx) => (
                      <Cell key={idx} fill={entry.color} fillOpacity={0.8} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Why ML wins */}
          <div className="mt-8 bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h3 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">
              Why the difference matters
            </h3>
            <div className="grid md:grid-cols-3 gap-6 text-sm text-gray-400">
              <div>
                <h4 className="text-white font-medium mb-1">Non-linear patterns</h4>
                <p>
                  Formulas use fixed multipliers (1.45x for rush hour). ML learns that 8am on Monday is
                  different from 5pm on Friday -- the data shows it.
                </p>
              </div>
              <div>
                <h4 className="text-white font-medium mb-1">Feature interactions</h4>
                <p>
                  Snow + rush hour is not just snow_mult * rush_mult. ML captures the compounding
                  effect where snow during rush hour causes disproportionate delays.
                </p>
              </div>
              <div>
                <h4 className="text-white font-medium mb-1">Confidence intervals</h4>
                <p>
                  Formulas give one number. ML gives you a range -- "15-22 min with 80% confidence"
                  is far more useful for planning than a single point estimate.
                </p>
              </div>
            </div>
          </div>
        </>
      )}

      {results.length === 0 && !loading && (
        <div className="text-center py-20 text-gray-600">
          <div className="text-6xl mb-4 opacity-30">&#128200;</div>
          <p className="text-sm">Click "Run Comparison" to generate test scenarios</p>
        </div>
      )}
    </div>
  );
}
