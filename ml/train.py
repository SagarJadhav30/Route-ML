"""
routeml / train.py
Generate 100k synthetic delivery records and train a LightGBM regressor.

Features:
  distance_km, hour_of_day, day_of_week, weather_encoded,
  is_rush_hour, is_weekend

Target:
  delivery_time_minutes
"""

import os
import numpy as np 
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import lightgbm as lgb
import joblib

SEED = 42
N_SAMPLES = 100_000
MODEL_DIR = os.path.join(os.path.dirname(__file__), "model")

np.random.seed(SEED)


# ---------------------------------------------------------------------------
# 1. Synthetic data generation
# ---------------------------------------------------------------------------
 
def generate_data(n: int = N_SAMPLES) -> pd.DataFrame:
    distance_km = np.random.lognormal(mean=2.0, sigma=0.8, size=n).clip(0.5, 120)
    hour_of_day = np.random.randint(0, 24, size=n)
    day_of_week = np.random.randint(0, 7, size=n)  # 0=Mon ... 6=Sun
    weather = np.random.choice(["clear", "rain", "snow"], size=n, p=[0.70, 0.20, 0.10])

    is_rush_hour = ((hour_of_day >= 7) & (hour_of_day <= 9)) | (
        (hour_of_day >= 17) & (hour_of_day <= 19)
    ) 
    is_weekend = (day_of_week >= 5).astype(int)

    # Base speed: 30-40 km/h in city
    base_speed = np.random.normal(35, 4, size=n).clip(15, 60)

    # ---------- Realistic traffic patterns ----------
    traffic_mult = np.ones(n)

    # Rush hour: +30-50%
    rush_mask = is_rush_hour.astype(bool)
    traffic_mult[rush_mask] *= np.random.uniform(1.30, 1.50, size=rush_mask.sum())

    # Late night: faster
    night_mask = (hour_of_day >= 22) | (hour_of_day <= 5)
    traffic_mult[night_mask] *= np.random.uniform(0.70, 0.85, size=night_mask.sum())

    # Midday bump
    midday_mask = (hour_of_day >= 10) & (hour_of_day <= 16)
    traffic_mult[midday_mask] *= np.random.uniform(1.05, 1.15, size=midday_mask.sum())

    # Weekend discount
    traffic_mult[is_weekend == 1] *= np.random.uniform(0.80, 0.90, size=(is_weekend == 1).sum())

    # ---------- Weather effects ----------
    weather_mult = np.ones(n)
    rain_mask = weather == "rain"
    snow_mask = weather == "snow"
    weather_mult[rain_mask] *= np.random.uniform(1.10, 1.20, size=rain_mask.sum())
    weather_mult[snow_mask] *= np.random.uniform(1.30, 1.50, size=snow_mask.sum())

    # ---------- Non-linear distance effect ----------
    # Short trips have more overhead (parking, loading); long trips have highway segments
    overhead_minutes = np.random.uniform(3, 8, size=n)  # pickup / dropoff time
    drive_time = (distance_km / base_speed) * 60.0 * traffic_mult * weather_mult

    # Non-linear: long distances get slightly faster per km (highway effect)
    highway_discount = np.where(distance_km > 20, 0.92, 1.0)
    drive_time *= highway_discount

    delivery_time = drive_time + overhead_minutes

    # Add realistic noise (sigma proportional to ETA)
    noise = np.random.normal(0, delivery_time * 0.08)
    delivery_time += noise
    delivery_time = delivery_time.clip(2, 600)

    # Encode weather numerically
    weather_encoded = np.where(weather == "clear", 0, np.where(weather == "rain", 1, 2))

    df = pd.DataFrame(
        {
            "distance_km": np.round(distance_km, 2),
            "hour_of_day": hour_of_day,
            "day_of_week": day_of_week,
            "weather_encoded": weather_encoded,
            "is_rush_hour": is_rush_hour.astype(int),
            "is_weekend": is_weekend,
            "delivery_time_minutes": np.round(delivery_time, 2),
        }
    )
    return df


# ---------------------------------------------------------------------------
# 2. Train
# ---------------------------------------------------------------------------

def train():
    print("Generating 100k synthetic delivery records...")
    df = generate_data()
    print(f"  shape: {df.shape}")
    print(f"  delivery_time stats:\n{df['delivery_time_minutes'].describe()}\n")

    features = [
        "distance_km",
        "hour_of_day",
        "day_of_week",
        "weather_encoded",
        "is_rush_hour",
        "is_weekend",
    ]
    X = df[features]
    y = df["delivery_time_minutes"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=SEED
    )

    # --- Median model (point estimate) ---
    print("Training LightGBM regressor (point estimate)...")
    model = lgb.LGBMRegressor(
        n_estimators=600,
        learning_rate=0.05,
        max_depth=8,
        num_leaves=63,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=SEED,
        verbose=-1,
    )
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    mae = mean_absolute_error(y_test, y_pred)
    rmse = np.sqrt(mean_squared_error(y_test, y_pred))
    r2 = r2_score(y_test, y_pred)

    print(f"\n--- Point Estimate Metrics ---")
    print(f"  MAE  : {mae:.2f} min")
    print(f"  RMSE : {rmse:.2f} min")
    print(f"  R2   : {r2:.4f}")

    # --- Quantile models for confidence interval ---
    print("\nTraining quantile models (10th / 90th percentile)...")
    model_low = lgb.LGBMRegressor(
        objective="quantile",
        alpha=0.10,
        n_estimators=400,
        learning_rate=0.05,
        max_depth=7,
        num_leaves=50,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=SEED,
        verbose=-1,
    )
    model_low.fit(X_train, y_train)

    model_high = lgb.LGBMRegressor(
        objective="quantile",
        alpha=0.90,
        n_estimators=400,
        learning_rate=0.05,
        max_depth=7,
        num_leaves=50,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=SEED,
        verbose=-1,
    )
    model_high.fit(X_train, y_train)

    # Verify coverage
    y_low = model_low.predict(X_test)
    y_high = model_high.predict(X_test)
    coverage = np.mean((y_test >= y_low) & (y_test <= y_high))
    print(f"  80% interval coverage on test set: {coverage:.1%}")

    # --- Feature importances ---
    importances = dict(zip(features, map(float, model.feature_importances_)))
    total = sum(importances.values())
    importances = {k: round(v / total, 4) for k, v in importances.items()}
    print(f"\n  Feature importances (normalized): {importances}")

    # --- Save ---
    os.makedirs(MODEL_DIR, exist_ok=True)
    joblib.dump(model, os.path.join(MODEL_DIR, "model.joblib"))
    joblib.dump(model_low, os.path.join(MODEL_DIR, "model_low.joblib"))
    joblib.dump(model_high, os.path.join(MODEL_DIR, "model_high.joblib"))
    joblib.dump(features, os.path.join(MODEL_DIR, "features.joblib"))
    print(f"\nModels saved to {MODEL_DIR}/")


if __name__ == "__main__":
    train()
