# routeml

ML-powered delivery ETA prediction engine. Trained on synthetic data, served over a Go API, visualized in a React dashboard.

This exists because formula-based approaches (distance / speed * multiplier) hit a ceiling fast. The real world is non-linear. ML learns that.
 
## What it does 
 
You give it a route (origin, destination, distance, time of day, weather). It returns:

- **ML prediction**: LightGBM-estimated ETA in minutes
- **Confidence interval**: 80% band via quantile regression (not a hack -- separate models for 10th and 90th percentiles)
- **Formula baseline**: The classic `distance / avg_speed * traffic_mult * weather_mult` approach, for comparison
- **Feature importances**: Which inputs actually matter for this prediction

## Architecture

```
                ┌─────────────────────────────────────────────┐
                │               dashboard (:5173)             │
                │         React + Tailwind + Recharts         │
                └──────────────────┬──────────────────────────┘
                                   │ /api/*
                                   ▼
                ┌─────────────────────────────────────────────┐
                │               Go API (:8080)                │
                │            Fiber + CORS + Logger            │
                │                                             │
                │  POST /api/predict  ──► ML + formula        │
                │  GET  /api/compare  ──► side-by-side        │
                │  GET  /api/health   ──► status check        │
                │                                             │
                │  formula engine:                            │
                │    distance / 35 kmh * traffic * weather    │
                └──────────────────┬──────────────────────────┘
                                   │ POST /predict
                                   ▼
                ┌─────────────────────────────────────────────┐
                │           Python ML service (:5000)         │
                │           FastAPI + LightGBM                │
                │                                             │
                │  3 models loaded at startup:                │
                │    - median regressor (point estimate)      │
                │    - quantile 0.10 (confidence low)         │
                │    - quantile 0.90 (confidence high)        │
                │                                             │
                │  trained on 100k synthetic records          │
                └─────────────────────────────────────────────┘
```

## Why ML beats formulas

This is the core argument. Here are concrete examples.

**1. Non-linear traffic patterns**
 
A formula says rush hour = 1.45x. Always. But 8am Monday in January is different from 5pm Friday in summer. The formula can't tell them apart. LightGBM learns splits like "if hour=8 AND day=0 AND weather=snow, then add 18 minutes" -- automatically, from data.

**2. Feature interactions the formula ignores** 

Snow during rush hour is not `1.4 * 1.45 = 2.03x`. It's worse. Accidents spike. Plows block lanes. The multiplicative model underestimates compound effects. Tree-based models capture these interactions natively through their branching structure.

**3. Distance non-linearity**

A 50km trip is not 10x a 5km trip. Longer routes hit highways (faster per-km). Short routes have proportionally more overhead (parking, loading, last-mile). Formulas with `distance / speed` miss this entirely. The model learns the curve.

**4. Confidence intervals**

The formula gives you one number: "23 minutes." That is almost certainly wrong. The ML system gives you "19-28 minutes with 80% confidence." For logistics planning, knowing the range is worth more than a false-precision point estimate.

**5. Measurable improvement**

On the synthetic test set (20k samples):
- LightGBM MAE: ~2-3 minutes
- LightGBM R2: ~0.98+
- Formula MAE: typically 4-6 minutes (varies with scenario mix)

The ML model is consistently 40-60% more accurate on MAE.

## Phases

```
Phase 1: Data generation
  └─► 100k synthetic records with realistic patterns
       (rush hour, weather, distance, weekday effects)

Phase 2: Model training
  └─► LightGBM regressor + 2 quantile models
       train.py generates data, trains, saves to model/

Phase 3: Serving
  └─► FastAPI loads models at startup
       Go API handles routing, formula fallback, CORS
       Dashboard provides the UI

Phase 4: Comparison
  └─► Dashboard runs 100+ scenarios through both approaches
       Scatter plots, error distributions, summary stats
```

## Running locally

### Option A: Docker Compose (recommended)

```bash
docker compose up --build
```

- Dashboard: http://localhost:5173
- API: http://localhost:8080
- ML service: http://localhost:5000

### Option B: Manual

**ML service:**
```bash
cd ml
pip install -r requirements.txt
python train.py          # generates model/
python main.py           # starts on :5000
```

**Go API:**
```bash
cd api
go mod tidy
go run main.go           # starts on :8080
```

**Dashboard:**
```bash
cd dashboard
npm install
npm run dev              # starts on :5173
```

## API Reference

### POST /api/predict

```json
{
  "origin_lat": 40.7128,
  "origin_lng": -74.006,
  "dest_lat": 40.7306,
  "dest_lng": -73.9866,
  "hour_of_day": 8,
  "day_of_week": 0,
  "weather": "rain",
  "distance_km": 5.0
}
```

Response:
```json
{
  "ml": {
    "eta_minutes": 18.42,
    "confidence_low": 14.8,
    "confidence_high": 22.1,
    "feature_importances": {
      "distance_km": 0.45,
      "hour_of_day": 0.22,
      "weather_encoded": 0.12,
      "is_rush_hour": 0.10,
      "day_of_week": 0.07,
      "is_weekend": 0.04
    }
  },
  "formula": {
    "eta_minutes": 14.21,
    "average_speed_kmh": 35,
    "traffic_multiplier": 1.45,
    "weather_multiplier": 1.15
  }
}
```

### GET /api/compare

Same inputs as query params. Returns both predictions plus delta analysis.

### GET /api/health

Returns service status and ML service connectivity.

## Tech stack

| Layer     | Tech                          |
|-----------|-------------------------------|
| ML        | LightGBM, scikit-learn, FastAPI |
| API       | Go, Fiber                     |
| Dashboard | React 18, Tailwind, Recharts, Vite |
| Infra     | Docker Compose                |

## Design decisions

- **LightGBM over XGBoost**: Faster training on 100k rows, native quantile regression support, lower memory.
- **Separate quantile models**: Could use a single model with custom loss, but separate models are simpler to debug and the overhead is negligible.
- **Go API as gateway**: The Go layer handles CORS, formula computation, and ML service orchestration. If the ML service is down, the formula engine still works as a fallback.
- **Synthetic data**: Real delivery data is proprietary. The synthetic generator captures the patterns that matter (rush hour, weather, distance non-linearity, overhead). Plug in real data and retrain -- the architecture doesn't change.
