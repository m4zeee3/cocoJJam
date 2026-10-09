"""Run a local photo through an exported TFLite model; nothing is uploaded."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from common import ROOT, SIZE, read_rgb
from export_tflite import predict_tflite


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path)
    parser.add_argument("--export", type=Path, default=ROOT / "models" / "mobilenetv3-small-v1" / "tflite-float16-v1")
    args = parser.parse_args()

    import tensorflow as tf

    for name in ("model.tflite", "labels.json", "deployment.json"):
        if not (args.export / name).is_file():
            raise FileNotFoundError(f"Export artifact not found: {args.export / name}")
    deployment = json.loads((args.export / "deployment.json").read_text(encoding="utf-8"))
    labels = json.loads((args.export / "labels.json").read_text(encoding="utf-8"))
    if labels != deployment["labels"]:
        raise ValueError("labels.json does not match deployment metadata.")
    if deployment["input_shape"] != [1, SIZE, SIZE, 3]:
        raise ValueError(f"Unexpected deployment input shape: {deployment['input_shape']}")
    if deployment["resize"] != "bilinear stretch" or deployment["input_range"] != [0, 255]:
        raise ValueError("Unsupported deployment preprocessing contract.")

    interpreter = tf.lite.Interpreter(model_path=str(args.export / "model.tflite"))
    interpreter.allocate_tensors()
    input_detail = interpreter.get_input_details()[0]
    output_detail = interpreter.get_output_details()[0]
    image = tf.image.resize(read_rgb(args.image), [SIZE, SIZE], method="bilinear").numpy()
    probabilities = predict_tflite(interpreter, input_detail, output_detail, image[np.newaxis, ...])[0]
    if not np.isfinite(probabilities).all() or not np.isclose(probabilities.sum(), 1, atol=1e-4):
        raise ValueError("TFLite output is not a valid probability distribution.")
    top = np.argsort(-probabilities)[:3]
    threshold = deployment["confidence_threshold"]
    accepted = threshold is not None and probabilities[top[0]] >= threshold
    print(json.dumps({
        "image": str(args.image),
        "decision": "accepted" if accepted else "uncertain",
        "threshold": threshold,
        "top_3": [{"label": labels[i], "confidence": float(probabilities[i])} for i in top],
        "note": "Visual freshness estimate, not food-safety certification.",
    }, indent=2))


if __name__ == "__main__":
    main()
