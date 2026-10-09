"""Inspect calibrated top-three predictions for a local image; nothing is uploaded."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from scipy.special import softmax

from common import ROOT, SIZE, file_hash, read_rgb


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path)
    parser.add_argument("--run", type=Path, default=ROOT / "models" / "mobilenetv3-small-v1")
    parser.add_argument("--calibration", type=Path, help="Defaults to RUN/evaluation/calibration.json")
    args = parser.parse_args()
    import tensorflow as tf

    calibration = json.loads((args.calibration or args.run / "evaluation" / "calibration.json").read_text(encoding="utf-8"))
    labels = json.loads((args.run / "labels.json").read_text(encoding="utf-8"))
    if labels != calibration["labels"] or file_hash(args.run / "model.keras") != calibration["model_sha256"]:
        raise ValueError("Calibration does not belong to this model/label order. Evaluate this model first.")
    model = tf.keras.models.load_model(args.run / "model.keras", compile=False)
    image = tf.image.resize(read_rgb(args.image), [SIZE, SIZE], method="bilinear")[None, ...]
    logits = model(image, training=False).numpy()[0]
    probabilities = softmax(logits / calibration["temperature"])
    top = np.argsort(-probabilities)[:3]
    threshold = calibration["confidence_threshold"]
    accepted = threshold is not None and probabilities[top[0]] >= threshold
    print(json.dumps({"image": str(args.image), "decision": "accepted" if accepted else "uncertain",
                      "message": "Visual freshness estimate" if accepted else "Hindi sigurado. Try a clearer photo.",
                      "threshold": threshold,
                      "top_3": [{"label": labels[i], "confidence": float(probabilities[i])} for i in top]}, indent=2))


if __name__ == "__main__":
    main()
