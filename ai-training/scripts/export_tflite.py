"""Export calibrated MobileNetV3 to float16 TFLite and compare with Keras."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from scipy.special import softmax

from common import ROOT, SIZE, dataset, file_hash, metrics, read_manifest, read_rgb, write_json


def load_artifacts(run: Path, manifest: Path) -> tuple[list[str], dict, dict]:
    calibration_path = run / "evaluation" / "calibration.json"
    report_path = run / "evaluation" / "report.json"
    for path in (run / "model.keras", run / "labels.json", run / "config.json",
                 calibration_path, report_path):
        if not path.is_file():
            raise FileNotFoundError(f"Required artifact not found: {path}")

    labels = json.loads((run / "labels.json").read_text(encoding="utf-8"))
    calibration = json.loads(calibration_path.read_text(encoding="utf-8"))
    report = json.loads(report_path.read_text(encoding="utf-8"))
    model_hash = file_hash(run / "model.keras")
    manifest_hash = file_hash(manifest)
    if labels != calibration["labels"] or labels != report["labels"]:
        raise ValueError("Training, calibration, and report label orders do not match.")
    if model_hash != calibration["model_sha256"] or model_hash != report["model_sha256"]:
        raise ValueError("Calibration/report does not belong to this Keras model.")
    if manifest_hash != calibration["manifest_sha256"] or manifest_hash != report["manifest_sha256"]:
        raise ValueError("Calibration/report does not belong to this manifest.")
    if not isinstance(calibration["temperature"], (int, float)) or calibration["temperature"] <= 0:
        raise ValueError("Calibration temperature must be positive.")
    threshold = calibration["confidence_threshold"]
    if threshold is not None and not 0 <= threshold <= 1:
        raise ValueError("Calibration confidence threshold must be between 0 and 1.")
    return labels, calibration, report


def validate_probabilities(probabilities: np.ndarray, count: int, class_count: int) -> None:
    if probabilities.shape != (count, class_count):
        raise ValueError(f"Expected {count} rows and {class_count} classes, got {probabilities.shape}.")
    if not np.isfinite(probabilities).all():
        raise ValueError("TFLite model produced non-finite probabilities.")
    if (probabilities < -1e-5).any() or (probabilities > 1 + 1e-5).any():
        raise ValueError("TFLite model output is outside the probability range.")
    if not np.allclose(probabilities.sum(axis=1), 1, atol=1e-4):
        raise ValueError("TFLite model outputs do not sum to 1; calibration may be missing.")


def predict_tflite(interpreter, input_detail: dict, output_detail: dict,
                   images: np.ndarray) -> np.ndarray:
    results = []
    for image in images:
        tensor = image[np.newaxis, ...]
        dtype = input_detail["dtype"]
        if dtype == np.uint8:
            tensor = np.clip(np.rint(tensor), 0, 255).astype(np.uint8)
        else:
            tensor = tensor.astype(dtype)
        interpreter.set_tensor(input_detail["index"], tensor)
        interpreter.invoke()
        result = interpreter.get_tensor(output_detail["index"])[0].astype(np.float64)
        results.append(result)
    return np.asarray(results)


def export(args: argparse.Namespace) -> None:
    import tensorflow as tf

    labels, calibration, report = load_artifacts(args.run, args.manifest)
    rows, manifest_labels = read_manifest(args.manifest, args.data)
    if labels != manifest_labels:
        raise ValueError("Training labels or their order do not match the manifest.")
    if args.output.exists() and any(args.output.iterdir()):
        raise ValueError(f"Export output is not empty. Choose a new --output: {args.output}")

    model = tf.keras.models.load_model(args.run / "model.keras", compile=False)
    if model.output_shape[-1] != len(labels):
        raise ValueError("Keras model output does not match the saved label count.")

    calibrated_outputs = tf.keras.layers.Softmax(name="calibrated_probabilities")(
        model.output / float(calibration["temperature"])
    )
    calibrated_model = tf.keras.Model(model.inputs, calibrated_outputs)
    converter = tf.lite.TFLiteConverter.from_keras_model(calibrated_model)
    if args.precision == "float16":
        converter.optimizations = [tf.lite.Optimize.DEFAULT]
        converter.target_spec.supported_types = [tf.float16]
    tflite_bytes = converter.convert()

    args.output.mkdir(parents=True, exist_ok=True)
    model_path = args.output / "model.tflite"
    model_path.write_bytes(tflite_bytes)
    write_json(args.output / "labels.json", labels)

    interpreter = tf.lite.Interpreter(model_path=str(model_path))
    interpreter.allocate_tensors()
    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()
    if len(input_details) != 1 or len(output_details) != 1:
        raise ValueError("Expected a single model input and output.")
    input_detail, output_detail = input_details[0], output_details[0]
    if list(input_detail["shape"]) != [1, SIZE, SIZE, 3]:
        raise ValueError(f"Unexpected TFLite input shape: {input_detail['shape']}.")
    if input_detail["dtype"] not in (np.float32, np.uint8):
        raise ValueError(f"Unsupported TFLite input dtype: {input_detail['dtype']}.")
    if output_detail["dtype"] != np.float32 or list(output_detail["shape"]) != [1, len(labels)]:
        raise ValueError(f"Unexpected TFLite output: {output_detail['shape']} {output_detail['dtype']}.")

    test_rows = [row for row in rows if row["split"] == "test"]
    test_dataset = dataset(test_rows, labels, args.data, args.batch_size)
    probability_batches = [
        predict_tflite(interpreter, input_detail, output_detail, images.numpy())
        for images, _ in test_dataset
    ]
    tflite_probabilities = np.concatenate(probability_batches)
    validate_probabilities(tflite_probabilities, len(test_rows), len(labels))

    keras_logits = model.predict(
        dataset(test_rows, labels, args.data, args.batch_size),
        verbose=1,
    )
    keras_probabilities = softmax(keras_logits / float(calibration["temperature"]), axis=1)
    targets = np.asarray([labels.index(row["label"]) for row in test_rows])
    max_abs_error = float(np.max(np.abs(tflite_probabilities - keras_probabilities)))
    mean_abs_error = float(np.mean(np.abs(tflite_probabilities - keras_probabilities)))
    class_agreement = float(np.mean(tflite_probabilities.argmax(axis=1) == keras_probabilities.argmax(axis=1)))
    tflite_metrics = metrics(targets, tflite_probabilities, labels, calibration["confidence_threshold"])
    keras_metrics = report["calibrated"]
    accuracy_delta = float(tflite_metrics["accuracy"] - keras_metrics["accuracy"])
    false_fresh = tflite_metrics["false_fresh"]
    probability_differences = np.abs(tflite_probabilities - keras_probabilities)
    per_image_max_error = probability_differences.max(axis=1)
    worst_indices = np.argsort(-per_image_max_error)[:5]
    keras_top = keras_probabilities.argmax(axis=1)
    tflite_top = tflite_probabilities.argmax(axis=1)
    threshold = calibration["confidence_threshold"]
    if threshold is None:
        keras_accepted = np.zeros(len(test_rows), dtype=bool)
        tflite_accepted = np.zeros(len(test_rows), dtype=bool)
    else:
        keras_accepted = keras_probabilities.max(axis=1) >= threshold
        tflite_accepted = tflite_probabilities.max(axis=1) >= threshold
    validation = {
        "format": f"TFLite {args.precision} weights, float32 input/output",
        "input": {"shape": [1, SIZE, SIZE, 3], "dtype": np.dtype(input_detail["dtype"]).name,
                  "color": "RGB", "range": "0..255", "resize": "bilinear stretch"},
        "output": {"shape": [1, len(labels)], "dtype": np.dtype(output_detail["dtype"]).name,
                   "meaning": "softmax(logits / calibration temperature); class probabilities"},
        "labels": labels,
        "temperature": calibration["temperature"],
        "confidence_threshold": calibration["confidence_threshold"],
        "test_count": len(test_rows),
        "keras_model_sha256": file_hash(args.run / "model.keras"),
        "tflite_model_sha256": file_hash(model_path),
        "manifest_sha256": file_hash(args.manifest),
        "comparison": {
            "max_absolute_probability_error": max_abs_error,
            "mean_absolute_probability_error": mean_abs_error,
            "top_class_agreement": class_agreement,
            "top_class_disagreements": int(np.count_nonzero(keras_top != tflite_top)),
            "threshold_decision_agreement": float(np.mean(keras_accepted == tflite_accepted)),
            "threshold_decision_disagreements": int(np.count_nonzero(keras_accepted != tflite_accepted)),
            "keras_test_accuracy": keras_metrics["accuracy"],
            "tflite_test_accuracy": tflite_metrics["accuracy"],
            "test_accuracy_delta": accuracy_delta,
            "keras_test_macro_f1": keras_metrics["macro_f1"],
            "tflite_test_macro_f1": tflite_metrics["macro_f1"],
            "tflite_false_fresh": false_fresh,
            "tflite_selective": tflite_metrics["selective"],
            "tflite_by_category": tflite_metrics["by_category"],
            "tflite_per_class": tflite_metrics["classification_report"],
            "largest_probability_differences": [
                {
                    "path": test_rows[i]["path"],
                    "true_label": test_rows[i]["label"],
                    "keras_label": labels[keras_top[i]],
                    "keras_confidence": float(keras_probabilities[i, keras_top[i]]),
                    "tflite_label": labels[tflite_top[i]],
                    "tflite_confidence": float(tflite_probabilities[i, tflite_top[i]]),
                    "max_absolute_probability_error": float(per_image_max_error[i]),
                    "keras_decision": "accepted" if keras_accepted[i] else "uncertain",
                    "tflite_decision": "accepted" if tflite_accepted[i] else "uncertain",
                }
                for i in worst_indices
            ],
        },
        "app_integration_notes": [
            "Use labels.json in this exact output order; these are model classes, not renamed app stages.",
            "Apply the confidence threshold to the maximum output probability; below it, mark the result uncertain.",
            "Resize photos to 224x224 RGB with bilinear stretch and feed raw 0..255 values.",
            "Predictions estimate visual freshness and are not food-safety certification.",
        ],
    }
    write_json(args.output / "validation.json", validation)
    deployment = {
        "input_shape": [1, SIZE, SIZE, 3],
        "input_dtype": np.dtype(input_detail["dtype"]).name,
        "input_color": "RGB",
        "input_range": [0, 255],
        "resize": "bilinear stretch",
        "labels": labels,
        "temperature": calibration["temperature"],
        "confidence_threshold": calibration["confidence_threshold"],
        "output": "calibrated class probabilities, in labels.json order",
        "source_model_sha256": file_hash(args.run / "model.keras"),
        "tflite_model_sha256": file_hash(model_path),
    }
    write_json(args.output / "deployment.json", deployment)
    print(json.dumps({
        "export": str(args.output),
        "precision": args.precision,
        "tflite_size_bytes": len(tflite_bytes),
        "test_count": len(test_rows),
        "max_absolute_probability_error": max_abs_error,
        "top_class_agreement": class_agreement,
        "keras_test_accuracy": keras_metrics["accuracy"],
        "tflite_test_accuracy": tflite_metrics["accuracy"],
        "tflite_false_fresh": false_fresh,
        "validation": str(args.output / "validation.json"),
    }, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=ROOT / "training_datasets")
    parser.add_argument("--manifest", type=Path, default=ROOT / "reports" / "prepared" / "manifest.csv")
    parser.add_argument("--run", type=Path, default=ROOT / "models" / "mobilenetv3-small-v1")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--precision", choices=("float32", "float16"), default="float32")
    parser.add_argument("--batch-size", type=int, default=32)
    args = parser.parse_args()
    args.output = args.output or args.run / f"tflite-{args.precision}-v1"
    if args.batch_size < 1:
        parser.error("Batch size must be positive.")
    export(args)


if __name__ == "__main__":
    main()
