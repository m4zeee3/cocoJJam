"""Calibrate on the calibration split, then evaluate the untouched test split."""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import numpy as np
from scipy.special import softmax

from common import (ROOT, choose_threshold, dataset, file_hash, fit_temperature,
                    metrics, read_manifest, write_json)


def plot_reports(output: Path, report: dict, labels: list[str]) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(12, 10))
    matrix = np.array(report["calibrated"]["confusion_matrix"])
    ax.imshow(matrix, cmap="Blues")
    ax.set(xticks=range(len(labels)), yticks=range(len(labels)), xticklabels=labels,
           yticklabels=labels, xlabel="Predicted label", ylabel="True label", title="Held-out test confusion matrix")
    plt.setp(ax.get_xticklabels(), rotation=65, ha="right")
    for (y, x), value in np.ndenumerate(matrix):
        ax.text(x, y, str(value), ha="center", va="center", color="white" if value > matrix.max() / 2 else "black")
    fig.tight_layout()
    fig.savefig(output / "confusion_matrix.png", dpi=160)
    plt.close(fig)
    fig, ax = plt.subplots(figsize=(7, 6))
    ax.plot([0, 1], [0, 1], "k--", label="Ideal calibration")
    for kind in ("raw", "calibrated"):
        bins = [b for b in report[kind]["reliability_bins"] if b["count"]]
        ax.plot([b["confidence"] for b in bins], [b["accuracy"] for b in bins], "o-", label=kind)
    ax.set(xlim=(0, 1), ylim=(0, 1), xlabel="Mean predicted confidence", ylabel="Observed accuracy",
           title="Held-out test reliability")
    ax.legend()
    fig.tight_layout()
    fig.savefig(output / "reliability.png", dpi=160)
    plt.close(fig)


def evaluate(args: argparse.Namespace) -> None:
    import tensorflow as tf

    output = args.output or args.run / "evaluation"
    if output.exists() and any(output.iterdir()):
        raise ValueError("Evaluation output is not empty. Preserve the first test evaluation; use a new --output if necessary.")
    rows, labels = read_manifest(args.manifest, args.data)
    saved_labels = json.loads((args.run / "labels.json").read_text(encoding="utf-8"))
    config = json.loads((args.run / "config.json").read_text(encoding="utf-8"))
    if labels != saved_labels or config["manifest_sha256"] != file_hash(args.manifest):
        raise ValueError("Labels or manifest changed since training. Evaluate against the original manifest.")
    model = tf.keras.models.load_model(args.run / "model.keras", compile=False)
    if model.output_shape[-1] != len(labels):
        raise ValueError("Model output does not match labels")
    output.mkdir(parents=True, exist_ok=True)

    def predict(split: str):
        subset = [r for r in rows if r["split"] == split]
        logits = model.predict(dataset(subset, labels, args.data, args.batch_size), verbose=1)
        if not np.isfinite(logits).all():
            raise ValueError("Model produced non-finite logits")
        targets = np.array([labels.index(r["label"]) for r in subset])
        return subset, logits, targets

    _, calibration_logits, calibration_targets = predict("calibration")
    temperature = fit_temperature(calibration_logits, calibration_targets)
    calibrated = softmax(calibration_logits / temperature, axis=1)
    threshold = choose_threshold(calibration_targets, calibrated, args.target_accuracy, args.min_accepted)
    calibration = {"temperature": temperature, "confidence_threshold": threshold,
                   "threshold_selection": "Lowest threshold >= 0.5 whose calibration accuracy Wilson 95% lower bound meets target",
                   "target_accuracy": args.target_accuracy, "min_accepted": args.min_accepted,
                   "model_sha256": file_hash(args.run / "model.keras"), "labels": labels,
                   "manifest_sha256": file_hash(args.manifest),
                   "status": "threshold_found" if threshold is not None else "abstain_all_no_supported_threshold",
                   "calibration_metrics": metrics(calibration_targets, calibrated, labels, threshold)}
    # Freeze calibration/decision settings before reading test predictions.
    write_json(output / "calibration.json", calibration)
    subset, logits, targets = predict("test")
    probabilities = softmax(logits / temperature, axis=1)
    report = {"labels": labels, "temperature": temperature, "confidence_threshold": threshold,
              "model_sha256": calibration["model_sha256"], "manifest_sha256": file_hash(args.manifest),
              "raw": metrics(targets, softmax(logits, axis=1), labels, threshold),
              "calibrated": metrics(targets, probabilities, labels, threshold),
              "note": "Confidence is not food safety certification. Review each class and independent phone photos before export. "
                      "Wilson intervals treat images as independent and can be optimistic for correlated photos within groups. "
                      "Threshold search is calibration-set selection, not a guarantee on unseen data."}
    write_json(output / "report.json", report)
    with (output / "predictions.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.writer(stream)
        writer.writerow(["path", "group", "true_label", "predicted_label", "raw_confidence", "calibrated_confidence",
                         "correct", "decision", "top_3"])
        raw = softmax(logits, axis=1)
        for i, row in enumerate(subset):
            top = np.argsort(-probabilities[i])[:3]
            confidence = float(probabilities[i, top[0]])
            accepted = threshold is not None and confidence >= threshold
            writer.writerow([row["path"], row["group"], row["label"], labels[top[0]], float(raw[i].max()),
                             confidence, bool(top[0] == targets[i]), "accepted" if accepted else "uncertain",
                             json.dumps([{ "label": labels[j], "confidence": float(probabilities[i, j])} for j in top])])
    plot_reports(output, report, labels)
    summary = report["calibrated"]
    print(json.dumps({"test_accuracy": summary["accuracy"], "macro_f1": summary["macro_f1"],
                      "accuracy_wilson_95": summary["accuracy_wilson_95"],
                      "expected_calibration_error": summary["expected_calibration_error"],
                      "confidence_threshold": threshold, "selective": summary["selective"],
                      "reports": str(output)}, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=ROOT / "training_datasets")
    parser.add_argument("--manifest", type=Path, default=ROOT / "reports" / "prepared" / "manifest.csv")
    parser.add_argument("--run", type=Path, default=ROOT / "models" / "mobilenetv3-small-v1")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--target-accuracy", type=float, default=0.90)
    parser.add_argument("--min-accepted", type=int, default=30)
    args = parser.parse_args()
    if not 0 < args.target_accuracy < 1 or min(args.min_accepted, args.batch_size) < 1:
        parser.error("Target accuracy must be between 0 and 1; counts must be positive")
    evaluate(args)


if __name__ == "__main__":
    main()
