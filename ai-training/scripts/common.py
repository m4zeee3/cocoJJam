"""Shared input contract and confidence statistics (no TensorFlow import at startup)."""
from __future__ import annotations

import csv
import hashlib
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("KERAS_HOME", str(ROOT / "models" / ".keras"))
os.environ.setdefault("MPLCONFIGDIR", str(ROOT / "reports" / ".matplotlib"))

import numpy as np
from PIL import Image, ImageOps
from scipy.optimize import minimize_scalar
from scipy.special import logsumexp, softmax
from sklearn.metrics import classification_report, confusion_matrix

SIZE = 224
SPLITS = ("train", "val", "calibration", "test")


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, allow_nan=False), encoding="utf-8")


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_manifest(path: Path, data: Path) -> tuple[list[dict], list[str]]:
    with path.open(newline="", encoding="utf-8") as stream:
        rows = list(csv.DictReader(stream))
    if not rows:
        raise ValueError("Empty manifest")
    labels = sorted({r["label"] for r in rows})
    groups, hashes, paths = {}, {}, set()
    for row in rows:
        image = (data / row["path"]).resolve()
        if not image.is_relative_to(data.resolve()) or not image.is_file():
            raise ValueError(f"Missing image or path outside data root: {image}")
        if row["path"] in paths:
            raise ValueError(f"Repeated manifest path: {row['path']}")
        paths.add(row["path"])
        if row["split"] not in SPLITS:
            raise ValueError(f"Unknown split: {row['split']}")
        for mapping, key in ((groups, row["group"]), (hashes, row["sha256"])):
            previous = mapping.setdefault(key, row["split"])
            if previous != row["split"]:
                raise ValueError("Manifest has group or image leakage across splits")
    for split in SPLITS:
        if {r["label"] for r in rows if r["split"] == split} != set(labels):
            raise ValueError(f"Every label must occur in {split}")
    return rows, labels


def read_rgb(path: str | Path) -> np.ndarray:
    with Image.open(path) as image:
        return np.asarray(ImageOps.exif_transpose(image).convert("RGB"), dtype=np.float32)


def dataset(rows: list[dict], labels: list[str], data: Path, batch: int,
            training: bool = False, seed: int = 42):
    import tensorflow as tf

    paths = [str(data / r["path"]) for r in rows]
    targets = [labels.index(r["label"]) for r in rows]
    ds = tf.data.Dataset.from_tensor_slices((paths, targets))
    if training:
        ds = ds.shuffle(len(rows), seed=seed, reshuffle_each_iteration=True)

    def decode(path, label):
        image = tf.numpy_function(lambda p: read_rgb(p.decode("utf-8")), [path], tf.float32)
        image.set_shape([None, None, 3])
        return tf.image.resize(image, [SIZE, SIZE], method="bilinear"), label

    ds = ds.map(decode, num_parallel_calls=tf.data.AUTOTUNE).batch(batch)
    if training:
        # Avoid aggressive color changes: appearance/color is relevant to freshness.
        augmentation = tf.keras.Sequential([
            tf.keras.layers.RandomFlip("horizontal", seed=seed),
            tf.keras.layers.RandomRotation(0.04, fill_mode="reflect", seed=seed + 1),
            tf.keras.layers.RandomZoom(0.1, fill_mode="reflect", seed=seed + 2),
        ])
        ds = ds.map(lambda x, y: (augmentation(x, training=True), y),
                    num_parallel_calls=tf.data.AUTOTUNE)
    return ds.prefetch(tf.data.AUTOTUNE)


def nll(logits: np.ndarray, targets: np.ndarray, temperature: float) -> float:
    scaled = logits / temperature
    return float(np.mean(logsumexp(scaled, axis=1) - scaled[np.arange(len(targets)), targets]))


def fit_temperature(logits: np.ndarray, targets: np.ndarray) -> float:
    result = minimize_scalar(lambda t: nll(logits, targets, float(np.exp(t))),
                             bounds=(-3.0, 3.0), method="bounded")
    temperature = float(np.exp(result.x))
    return temperature if result.success and nll(logits, targets, temperature) < nll(logits, targets, 1.0) else 1.0


def wilson(correct: int, total: int) -> list[float] | None:
    if total == 0:
        return None
    z = 1.959963984540054
    p = correct / total
    denominator = 1 + z * z / total
    centre = (p + z * z / (2 * total)) / denominator
    half = z * np.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator
    return [float(max(0, centre - half)), float(min(1, centre + half))]


def selective(targets: np.ndarray, probabilities: np.ndarray, threshold: float | None) -> dict:
    accepted = (probabilities.max(axis=1) >= threshold if threshold is not None
                else np.zeros(len(targets), dtype=bool))
    total = int(accepted.sum())
    correct = int(((probabilities.argmax(axis=1) == targets) & accepted).sum())
    return {"accepted": total, "total": len(targets),
            "coverage": total / len(targets) if len(targets) else 0.0,
            "accuracy": correct / total if total else None,
            "accuracy_wilson_95": wilson(correct, total)}


def choose_threshold(targets: np.ndarray, probabilities: np.ndarray,
                     target_accuracy: float, min_accepted: int) -> float | None:
    # Selection is calibration-only; test data must never enter this function.
    candidates = np.unique(np.concatenate(([0.5], probabilities.max(axis=1))))
    for threshold in candidates[candidates >= 0.5]:
        result = selective(targets, probabilities, float(threshold))
        if (result["accepted"] >= min_accepted
                and result["accuracy_wilson_95"][0] >= target_accuracy):
            return float(threshold)
    return None


def metrics(targets: np.ndarray, probabilities: np.ndarray, labels: list[str],
            threshold: float | None) -> dict:
    predictions = probabilities.argmax(axis=1)
    confidence = probabilities.max(axis=1)
    correct = predictions == targets
    bins = []
    for index in range(15):
        low, high = index / 15, (index + 1) / 15
        mask = (confidence >= low) & ((confidence < high) if index < 14 else (confidence <= high))
        bins.append({"low": low, "high": high, "count": int(mask.sum()),
                     "confidence": float(confidence[mask].mean()) if mask.any() else None,
                     "accuracy": float(correct[mask].mean()) if mask.any() else None})
    ece = sum(b["count"] / len(targets) * abs(b["confidence"] - b["accuracy"])
              for b in bins if b["count"])
    groups = {}
    # Fish eyes and gills are reported separately.
    for category in sorted({label.split("/")[0] if not label.startswith("fish/")
                            else "fish/" + label.split("/")[1].split("-")[0] for label in labels}):
        ids = [i for i, label in enumerate(labels) if label.startswith(category + ("-" if "/" in category else "/"))]
        mask = np.isin(targets, ids)
        groups[category] = {"count": int(mask.sum()), "accuracy": float(correct[mask].mean()) if mask.any() else None,
                            "selective": selective(targets[mask], probabilities[mask], threshold)}
    per_class = classification_report(targets, predictions, labels=list(range(len(labels))),
                                      target_names=labels, output_dict=True, zero_division=0)
    for i, label in enumerate(labels):
        mask = targets == i
        per_class[label]["recall_wilson_95"] = wilson(int(correct[mask].sum()), int(mask.sum()))
        per_class[label]["selective"] = selective(targets[mask], probabilities[mask], threshold)
    fresh_ids = [i for i, label in enumerate(labels) if label.split("/")[-1] in {"fresh", "eye-fresh", "gill-fresh"}]
    nonfresh = ~np.isin(targets, fresh_ids)
    false_fresh = nonfresh & np.isin(predictions, fresh_ids)
    accepted = confidence >= threshold if threshold is not None else np.zeros(len(targets), dtype=bool)
    return {"count": len(targets), "accuracy": float(correct.mean()),
            "accuracy_wilson_95": wilson(int(correct.sum()), len(targets)),
            "macro_f1": per_class["macro avg"]["f1-score"],
            "nll": float(-np.log(np.maximum(probabilities[np.arange(len(targets)), targets], 1e-12)).mean()),
            "brier_score": float(np.mean(np.sum((probabilities - np.eye(len(labels))[targets]) ** 2, axis=1))),
            "expected_calibration_error": ece, "reliability_bins": bins,
            "confusion_matrix": confusion_matrix(targets, predictions, labels=list(range(len(labels)))).tolist(),
            "classification_report": per_class, "by_category": groups,
            "false_fresh": {"nonfresh_test_images": int(nonfresh.sum()),
                            "predicted_fresh": int(false_fresh.sum()),
                            "accepted_as_fresh": int((false_fresh & accepted).sum())},
            "selective": selective(targets, probabilities, threshold),
            "threshold_sweep": {str(t): selective(targets, probabilities, t) for t in (0.5, 0.7, 0.8, 0.9, 0.95, 0.99)}}
