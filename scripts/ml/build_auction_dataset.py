#!/usr/bin/env python3
import csv
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "data" / "ai" / "sheet-data.json"
OUTPUT = ROOT / "data" / "ml" / "player_market_training.csv"

MARKET_ANCHORS = {
    "Virat Kohli": (18.0, 20.0, 21.0, 0.98),
    "Jasprit Bumrah": (18.0, 19.5, 21.0, 0.98),
    "Rohit Sharma": (18.0, 19.0, 20.5, 0.94),
    "Sai Sudharsan": (18.0, 19.0, 20.5, 0.92),
    "Shubman Gill": (17.0, 18.5, 20.0, 0.96),
    "Suryakumar Yadav": (16.0, 18.0, 20.0, 0.94),
    "Hardik Pandya": (15.0, 17.5, 19.5, 0.91),
    "Rishabh Pant": (16.0, 18.0, 20.0, 0.94),
    "Yashasvi Jaiswal": (15.0, 17.5, 19.5, 0.91),
    "Ruturaj Gaikwad": (14.0, 16.5, 18.5, 0.94),
    "Ravindra Jadeja": (13.0, 15.5, 18.0, 0.95),
    "Rashid Khan": (13.0, 15.5, 18.0, 0.94),
    "Sanju Samson": (12.0, 14.5, 17.0, 0.91),
    "Nicholas Pooran": (11.0, 14.0, 17.0, 0.84),
    "Kuldeep Yadav": (11.0, 13.5, 16.0, 0.88),
    "Mohammed Siraj": (10.0, 13.0, 16.0, 0.86),
    "Trent Boult": (9.0, 10.5, 12.0, 0.73),
}

BRAND = {
    "Virat Kohli": 100, "Rohit Sharma": 98, "MS Dhoni": 100,
    "Jasprit Bumrah": 91, "Hardik Pandya": 90, "Rishabh Pant": 88,
    "Ravindra Jadeja": 90, "Suryakumar Yadav": 86, "Shubman Gill": 85,
    "Sanju Samson": 81, "Ruturaj Gaikwad": 80, "Yashasvi Jaiswal": 78,
    "Trent Boult": 76, "Rashid Khan": 84, "Sai Sudharsan": 74,
}

LEADERSHIP = {
    "MS Dhoni": 100, "Rohit Sharma": 98, "Virat Kohli": 92,
    "Hardik Pandya": 88, "Rishabh Pant": 85, "Shubman Gill": 84,
    "Sanju Samson": 84, "Ruturaj Gaikwad": 83, "Ravindra Jadeja": 78,
}

def clamp(value, low, high):
    return max(low, min(high, value))

def main():
    source = json.loads(SOURCE.read_text())
    tables = source["tables"]
    rules = {row["player_id"]: row for row in tables["rules.Players"]}
    forms = {row["player_id"]: row for row in tables["rules.Player_Form"]}
    batting = {row["player_id"]: row for row in tables["batters.Batting_Attributes"]}
    bowling = {row["player_id"]: row for row in tables["bowlers.Bowling_Attributes"]}
    players = tables["playerMaster.Players"]
    rows = []

    for player in players:
        pid = player["player_id"]
        rule, form = rules[pid], forms[pid]
        bat, bowl = batting[pid], bowling[pid]
        name, role = player["player_name"], player["role"]
        overseas = 1 if str(player.get("overseas", "No")).lower() == "yes" else 0
        capped = 1 if str(player.get("capped_status", "")).lower() == "capped" else 0
        fielding = round((float(bowl.get("throw_accuracy_rating", 50)) + float(bowl.get("catching_efficiency", 50)) + float(bowl.get("diving_rating", 50))) / 3, 2)
        if role in ("BAT", "WK"):
            primary = float(player["batting_rating"])
        elif role == "AR":
            primary = float(player["batting_rating"]) * .48 + float(player["bowling_rating"]) * .52
        else:
            primary = float(player["bowling_rating"])

        brand = BRAND.get(name, clamp(primary * .58 + (10 if rule.get("consistency_type") == "ELITE" else 0), 25, 78))
        leadership = LEADERSHIP.get(name, clamp(35 + brand * .28, 35, 72))
        indian = 1 - overseas
        role_scarcity = 74
        if indian and role in ("AR", "WK"): role_scarcity = 91
        elif indian and role == "BOWLER" and "FAST" in str(rule.get("bowling_style", "")): role_scarcity = 94
        elif overseas and role == "BAT": role_scarcity = 62
        elif overseas: role_scarcity = 68
        availability = 92 if indian else 78
        age_market = 72
        if name in ("Rohit Sharma", "MS Dhoni", "Trent Boult"): age_market = 48
        elif name in ("Sai Sudharsan", "Yashasvi Jaiswal", "Shubman Gill", "Ruturaj Gaikwad"): age_market = 96
        core_affinity = clamp(primary * .56 + brand * .24 + leadership * .12 + (8 if player.get("retention_eligible") == "Yes" else 0), 20, 100)
        consistency_bonus = {"ELITE": 5, "HIGH": 2.5, "AVERAGE": 0, "LOW": -2}.get(rule.get("consistency_type"), 0)
        market_score = (
            primary * .49 + float(form.get("batting_form", 50) if role in ("BAT", "WK") else form.get("bowling_form", 50)) * .08
            + float(form.get("confidence", 50)) * .07 + fielding * .04 + brand * .12
            + leadership * .05 + role_scarcity * .09 + availability * .06
            + indian * 4 + capped * 1.5 + consistency_bonus
        )
        quality_band = clamp((market_score - 42) / 58, 0, 1)
        midpoint = .5 + math.pow(quality_band, 1.85) * 18.2
        if overseas: midpoint *= .88
        if role == "BOWLER": midpoint *= .92
        midpoint = clamp(midpoint, .5, 19.5)
        spread = clamp(1.1 + midpoint * .11, 1.1, 2.8)
        low, mid, high = round(max(.5, midpoint - spread), 2), round(midpoint, 2), round(min(20, midpoint + spread), 2)
        retention_probability = clamp((core_affinity - 45) / 55 * .72 + (mid / 20) * .28, .03, .97)
        label_source = "ENGINEERED"
        hard_floor, hard_ceiling = "", ""
        if name in MARKET_ANCHORS:
            low, mid, high, retention_probability = MARKET_ANCHORS[name]
            hard_floor, hard_ceiling = low, high
            label_source = "EXPERT_ANCHOR"

        rows.append({
            "player_id": pid, "name": name, "team": player.get("team") or "FREE_AGENT", "role": role,
            "nationality": player.get("nationality") or rule.get("nationality") or "Unknown",
            "overseas": overseas, "capped": capped, "batting_rating": player["batting_rating"],
            "bowling_rating": player["bowling_rating"], "fielding_rating": fielding,
            "form_rating": form.get("batting_form", 50) if role in ("BAT", "WK") else form.get("bowling_form", 50),
            "confidence": form.get("confidence", 50), "fitness": 100 - float(form.get("fatigue", 0)),
            "consistency_type": rule.get("consistency_type", "AVERAGE"),
            "expected_strike_rate": bat.get("expected_strike_rate", 100),
            "wicket_taking_rating": bowl.get("wicket_taking_rating", 0),
            "death_rating": max(float(bat.get("death_overs_rating", 0)), float(bowl.get("death_overs_rating", 0))),
            "brand_value": round(brand, 2), "leadership_value": round(leadership, 2),
            "role_scarcity": role_scarcity, "availability": availability, "age_market_factor": age_market,
            "core_team_affinity": round(core_affinity, 2), "target_price_low_cr": low,
            "target_price_mid_cr": mid, "target_price_high_cr": high,
            "retention_probability": round(retention_probability, 4), "hard_floor_cr": hard_floor,
            "hard_ceiling_cr": hard_ceiling, "label_source": label_source,
        })

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader(); writer.writerows(rows)
    print(f"wrote {len(rows)} players to {OUTPUT}")

if __name__ == "__main__":
    main()
