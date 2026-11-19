#!/usr/bin/env python3
import json
from pathlib import Path

import joblib
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import ExtraTreesRegressor, RandomForestRegressor
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "ml" / "player_market_training.csv"
MODEL_DIR = ROOT / "data" / "ml" / "models"
PREDICTIONS = ROOT / "data" / "ml" / "player-market-values.json"
REPORT = ROOT / "data" / "ml" / "training-report.json"

CATEGORICAL = ["role", "nationality", "consistency_type"]
NUMERIC = [
    "overseas", "capped", "batting_rating", "bowling_rating", "fielding_rating",
    "form_rating", "confidence", "fitness", "expected_strike_rate",
    "wicket_taking_rating", "death_rating", "brand_value", "leadership_value",
    "role_scarcity", "availability", "age_market_factor", "core_team_affinity",
]

def pipeline(model):
    return Pipeline([
        ("features", ColumnTransformer([
            ("category", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL),
            ("number", "passthrough", NUMERIC),
        ])),
        ("model", model),
    ])

def main():
    frame = pd.read_csv(DATA)
    x = frame[CATEGORICAL + NUMERIC]
    train_idx, test_idx = train_test_split(range(len(frame)), test_size=.22, random_state=42)
    targets = {
        "price_low": "target_price_low_cr", "price_mid": "target_price_mid_cr",
        "price_high": "target_price_high_cr", "retention": "retention_probability",
    }
    models, metrics = {}, {}
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    for key, target in targets.items():
        estimator = ExtraTreesRegressor(n_estimators=500, min_samples_leaf=2, max_features=.9, random_state=42, n_jobs=-1) if key != "retention" else RandomForestRegressor(n_estimators=500, min_samples_leaf=2, max_features=.85, random_state=42, n_jobs=-1)
        model = pipeline(estimator)
        model.fit(x.iloc[train_idx], frame[target].iloc[train_idx])
        predicted = model.predict(x.iloc[test_idx])
        metrics[key] = {"mae": round(float(mean_absolute_error(frame[target].iloc[test_idx], predicted)), 4), "r2": round(float(r2_score(frame[target].iloc[test_idx], predicted)), 4)}
        model.fit(x, frame[target])
        models[key] = model
        joblib.dump(model, MODEL_DIR / f"{key}.joblib")

    raw = {key: model.predict(x) for key, model in models.items()}
    output = {}
    for index, row in frame.iterrows():
        low, mid, high = float(raw["price_low"][index]), float(raw["price_mid"][index]), float(raw["price_high"][index])
        hard_floor = None if pd.isna(row["hard_floor_cr"]) else float(row["hard_floor_cr"])
        hard_ceiling = None if pd.isna(row["hard_ceiling_cr"]) else float(row["hard_ceiling_cr"])
        if hard_floor is not None: low = max(low, hard_floor)
        if hard_ceiling is not None: high = min(high, hard_ceiling)
        mid = max(low, min(high, mid))
        low, high = min(low, mid), max(high, mid)
        output[str(int(row["player_id"]))] = {
            "name": row["name"], "team": row["team"],
            "minValue": round(low * 2) / 2, "marketValue": round(mid * 2) / 2,
            "maxValue": round(high * 2) / 2,
            "retentionProbability": round(max(.01, min(.99, float(raw["retention"][index]))), 3),
            "labelSource": row["label_source"],
        }
    PREDICTIONS.write_text(json.dumps(output, indent=2))
    REPORT.write_text(json.dumps({"rows": len(frame), "features": CATEGORICAL + NUMERIC, "testSize": len(test_idx), "metrics": metrics, "randomSeed": 42}, indent=2))
    print(json.dumps({"rows": len(frame), "metrics": metrics}, indent=2))

if __name__ == "__main__":
    main()
