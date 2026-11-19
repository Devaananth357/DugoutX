"""Train a smoothed IPL delivery-outcome model from Cricsheet JSON.

Usage: python3 scripts/ml/train_match_outcomes.py [path/to/ipl_json.zip]
The generated model contains aggregates only, not the source deliveries.
"""

import json
import math
import sys
import urllib.request
import zipfile
from collections import Counter, defaultdict
from io import BytesIO
from pathlib import Path

SOURCE = "https://cricsheet.org/downloads/ipl_json.zip"
OUT = Path(__file__).resolve().parents[2] / "data/ai/match-outcome-model.json"
LABELS = ("0", "1", "2", "3", "4", "6", "W")


def features(over, wickets, position, balls_faced, since_wicket):
    phase = "PP" if over < 6 else "MID" if over < 16 else "DEATH"
    wicket_band = "LOW" if wickets <= 2 else "MID" if wickets <= 5 else "HIGH"
    batting_band = "TOP" if position <= 3 else "MIDDLE" if position <= 7 else "TAIL"
    settled = "NEW" if balls_faced < 5 else "SET" if balls_faced < 15 else "EST"
    after_wicket = "AFTER" if since_wicket < 3 else "NORMAL"
    return phase, wicket_band, batting_band, settled, after_wicket


def records(match):
    for innings in match["innings"]:
        order = {}
        balls_faced = Counter()
        wickets = 0
        since_wicket = 100
        for over in innings["overs"]:
            for delivery in over["deliveries"]:
                batter = delivery["batter"]
                order.setdefault(batter, len(order) + 1)
                extras = delivery.get("extras", {})
                legal = "wides" not in extras and "noballs" not in extras
                if not legal:
                    continue
                dismissed = any(
                    wicket.get("player_out") == batter
                    and wicket.get("kind") not in ("retired hurt", "obstructing the field")
                    for wicket in delivery.get("wickets", [])
                )
                runs = delivery["runs"]["batter"]
                label = "W" if dismissed else str(runs)
                if label in LABELS:
                    yield features(over["over"], wickets, order[batter], balls_faced[batter], since_wicket), label
                balls_faced[batter] += 1
                wicket_count = sum(w.get("kind") not in ("retired hurt", "obstructing the field") for w in delivery.get("wickets", []))
                wickets += wicket_count
                since_wicket = 0 if wicket_count else since_wicket + 1


def probabilities(counts, prior, strength):
    total = sum(counts.values()) + strength
    return [round((counts[label] + strength * prior[i]) / total, 6) for i, label in enumerate(LABELS)]


def main():
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    raw = source.read_bytes() if source else urllib.request.urlopen(SOURCE, timeout=60).read()
    archive = zipfile.ZipFile(BytesIO(raw))
    train, holdout = [], []
    train_matches = holdout_matches = 0
    for name in archive.namelist():
        if not name.endswith(".json"):
            continue
        match = json.loads(archive.read(name))
        year = int(str(match["info"]["dates"][0])[:4])
        if year < 2021 or year > 2026:
            continue
        if year == 2026:
            holdout.extend(records(match))
            holdout_matches += 1
        else:
            train.extend(records(match))
            train_matches += 1

    phase_counts = defaultdict(Counter)
    cells = defaultdict(Counter)
    for feature, label in train:
        phase_counts[feature[0]][label] += 1
        cells["|".join(feature)][label] += 1
    phase = {key: probabilities(counts, [1 / 7] * 7, 7) for key, counts in phase_counts.items()}
    groups = {key: probabilities(counts, phase[key.split("|")[0]], 80) for key, counts in cells.items()}

    def loss(use_groups):
        value = 0.0
        for feature, label in holdout:
            key = "|".join(feature)
            probs = groups.get(key, phase[feature[0]]) if use_groups else phase[feature[0]]
            value -= math.log(max(1e-8, probs[LABELS.index(label)]))
        return round(value / max(1, len(holdout)), 4)

    model = {
        "source": SOURCE,
        "license": "Open Data Commons Attribution License 1.0",
        "trainedSeasons": "2021–2025",
        "holdoutSeason": "2026",
        "trainMatches": train_matches,
        "trainDeliveries": len(train),
        "holdoutMatches": holdout_matches,
        "holdoutDeliveries": len(holdout),
        "labels": LABELS,
        "phase": phase,
        "groups": groups,
        "phaseBaselineLogLoss": loss(False),
        "modelLogLoss": loss(True),
    }
    OUT.write_text(json.dumps(model, separators=(",", ":")) + "\n")
    print(json.dumps({key: model[key] for key in ("trainMatches", "trainDeliveries", "holdoutMatches", "holdoutDeliveries", "phaseBaselineLogLoss", "modelLogLoss")}))


if __name__ == "__main__":
    main()
