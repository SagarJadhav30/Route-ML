"""
routeml / main.py
FastAPI prediction server on :5000
"""

import os
import subprocess
import sys

import joblib
import numpy as np  
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

MODEL_DIR = os.path.join(os.path.dirname(__file__), "model")

app = FastAPI(title="routeml-predict", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Load models at startup
# ---------------------------------------------------------------------------

model = None
model_low = None
model_high = None
features = None


@app.on_event("startup")
def load_models():
    global model, model_low, model_high, features

    model_path = os.path.join(MODEL_DIR, "model.joblib")
    if not os.path.exists(model_path):
        print("No trained model found -- running train.py first...")
        train_script = os.path.join(os.path.dirname(__file__), "train.py")
        subprocess.run([sys.executable, train_script], check=True)

    model = joblib.load(os.path.join(MODEL_DIR, "model.joblib"))
    model_low = joblib.load(os.path.join(MODEL_DIR, "model_low.joblib"))
    model_high = joblib.load(os.path.join(MODEL_DIR, "model_high.joblib"))
    features = joblib.load(os.path.join(MODEL_DIR, "features.joblib"))
    print(f"Models loaded. Features: {features}")


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

WEATHER_MAP = {"clear": 0, "rain": 1, "snow": 2}


class PredictRequest(BaseModel):
    distance_km: float
    hour_of_day: int
    day_of_week: int
    weather: str = "clear"
    is_rush_hour: int = 0
    is_weekend: int = 0


class PredictResponse(BaseModel):
    eta_minutes: float
    confidence_low: float
    confidence_high: float
    feature_importances: dict[str, float]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": model is not None}


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest):
    weather_encoded = WEATHER_MAP.get(req.weather, 0)

    row = np.array(
        [
            [
                req.distance_km,
                req.hour_of_day,
                req.day_of_week,
                weather_encoded,
                req.is_rush_hour,
                req.is_weekend,
            ]
        ]
    )

    eta = float(model.predict(row)[0])
    low = float(model_low.predict(row)[0])
    high = float(model_high.predict(row)[0])

    # Ensure sane bounds
    eta = max(eta, 1.0)
    low = max(low, 1.0)
    high = max(high, low + 0.5)

    importances = dict(zip(features, map(float, model.feature_importances_)))
    total = sum(importances.values())
    importances = {k: round(v / total, 4) for k, v in importances.items()}

    return PredictResponse(
        eta_minutes=round(eta, 2),
        confidence_low=round(low, 2),
        confidence_high=round(high, 2),
        feature_importances=importances,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=5000, reload=True)
