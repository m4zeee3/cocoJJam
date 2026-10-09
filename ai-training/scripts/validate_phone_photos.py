"""Evaluate exported TFLite predictions on independently labeled local photos."""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import numpy as np

from common import ROOT, SIZE, file_hash, metrics, read_rgb, write_json
from export_tflite import predict_tflite


def read_phone_manifest(path: Path, data: Path, labels: list[str]) -> list[dict[str, str]]:
    data_root = data.resolve()
    with path.open(newline="", encoding="utf-8") as stream:
        reader = csv.DictReader(stream)
        if not reader.fieldnames or not {"path", "label"}.issubset(reader.fieldnames):
            raise ValueError("Phone-photo CSV must contain path,label columns.")
        rows = list(reader)
    if not rows:
        raise ValueError("Phone-photo CSV has no labeled images.")

    seen_paths: set[str] = set()
    for row in rows:
        if not row.get("path") or not row.get("label"):
            raise ValueError("Every phone-photo CSV row needs a non-empty path and label.")
        if row["label"] not in labels:
            raise ValueError(f"Unknown label {row['label']!r}; expected one of: {', '.join(labels)}")
        image_path = (data_root / row["path"]).resolve()
        if not image_path.is_relative_to(data_root) or not image_path.is_file():
            raise ValueError(f"Missing image or path outside photo root: {row['path']!r}")
        key = str(image_path).casefold()
        if key in seen_paths:
            raise ValueError(f"Repeated phone-photo path: {row['path']!r}")
        seen_paths.add(key)
        row["absolute_path"] = str(image_path)
    return rows


def validate(args: argparse.Namespace) -> None:
    import tensorflow as tf

    for name in ("model.tflite", "labels.json", "deployment.json"):
        if not (args.export / name).is_file():
            raise FileNotFoundError(f"Export artifact not found: {args.export / name}")
    deployment = json.loads((args.export / "deployment.json").read_text(encoding="utf-8"))
    labels = json.loads((args.export / "labels.json").read_text(encoding="utf-8"))
    if labels != deployment["labels"]:
        raise ValueError("labels.json does not match deployment metadata.")
    if deployment["tflite_model_sha256"] != file_hash(args.export / "model.tflite"):
        raise ValueError("TFLite model hash does not match deployment metadata.")
    rows = read_phone_manifest(args.manifest, args.data, labels)
    if args.output and args.output.exists():
        raise ValueError(f"Report already exists. Choose a new --output: {args.output}")

    interpreter = tf.lite.Interpreter(model_path=str(args.export / "model.tflite"))
    interpreter.allocate_tensors()
    input_detail = interpreter.get_input_details()[0]
    output_detail = interpreter.get_output_details()[0]
    probabilities = []
    for start in range(0, len(rows), args.batch_size):
        batch_rows = rows[start:start + args.batch_size]
        images = np.stack([
            tf.image.resize(read_rgb(row["absolute_path"]), [SIZE, SIZE], method="bilinear").numpy()
            for row in batch_rows
        ])
        probabilities.append(predict_tflite(interpreter, input_detail, output_detail, images))
    predictions = np.concatenate(probabilities)
    if predictions.shape != (len(rows), len(labels)) or not np.isfinite(predictions).all():
        raise ValueError("TFLite returned invalid predictions for phone photos.")
    if not np.allclose(predictions.sum(axis=1), 1, atol=1e-4):
        raise ValueError("TFLite predictions are not calibrated probability distributions.")
    targets = np.asarray([labels.index(row["label"]) for row in rows])
    results = {
        "export_model_sha256": deployment["tflite_model_sha256"],
        "temperature": deployment["temperature"],
        "confidence_threshold": deployment["confidence_threshold"],
        "image_count": len(rows),
        "group_count": len({row.get("group_id") or row["path"] for row in rows}),
        "labels": labels,
        "metrics": metrics(targets, predictions, labels, deployment["confidence_threshold"]),
        "note": "Images must be independently captured and labels assigned without using this model's predictions. "
                "Results are a visual estimate, not food-safety certification.",
    }
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        write_json(args.output, results)
    print(json.dumps(results, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True, help="CSV with path,label and optional group_id")
    parser.add_argument("--data", type=Path, required=True, help="Root folder for the local phone photos")
    parser.add_argument("--export", type=Path, default=ROOT / "models" / "mobilenetv3-small-v1" / "tflite-float32-v1")
    parser.add_argument("--output", type=Path, help="Optional JSON report path")
    parser.add_argument("--batch-size", type=int, default=32)
    args = parser.parse_args()
    if args.batch_size < 1:
        parser.error("Batch size must be positive.")
    validate(args)


if __name__ == "__main__":
    main()
