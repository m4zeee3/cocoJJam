"""Train a 224x224 RGB MobileNetV3 Small classifier; no TFLite conversion."""
from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path

from common import ROOT, SIZE, dataset, file_hash, read_manifest, write_json


def train(args: argparse.Namespace) -> None:
    import tensorflow as tf

    if args.run.exists() and any(args.run.iterdir()):
        raise ValueError("Run directory is not empty. Choose a new --run to preserve existing models.")
    rows, labels = read_manifest(args.manifest, args.data)
    tf.keras.utils.set_random_seed(args.seed)
    config = {"architecture": "MobileNetV3Small", "image_size": SIZE, "input": "float32 RGB 0..255",
              "resize": "bilinear stretch", "output": "logits in labels.json order",
              "manifest_sha256": file_hash(args.manifest), "seed": args.seed,
              "tensorflow": tf.__version__, "arguments": {k: str(v) if isinstance(v, Path) else v for k, v in vars(args).items()}}
    train_rows = [r for r in rows if r["split"] == "train"]
    val_rows = [r for r in rows if r["split"] == "val"]
    training = dataset(train_rows, labels, args.data, args.batch_size, True, args.seed)
    validation = dataset(val_rows, labels, args.data, args.batch_size)
    counts = Counter(r["label"] for r in train_rows)
    weights = {i: len(train_rows) / (len(labels) * counts[label]) for i, label in enumerate(labels)}
    base = tf.keras.applications.MobileNetV3Small(
        input_shape=(SIZE, SIZE, 3), include_top=False, weights=args.weights,
        include_preprocessing=True, pooling="avg")
    args.run.mkdir(parents=True, exist_ok=True)
    write_json(args.run / "labels.json", labels)
    write_json(args.run / "config.json", config)
    base.trainable = False
    inputs = tf.keras.Input((SIZE, SIZE, 3), name="rgb_0_255")
    features = base(inputs, training=False)
    outputs = tf.keras.layers.Dense(len(labels), name="logits")(
        tf.keras.layers.Dropout(0.2)(features))
    model = tf.keras.Model(inputs, outputs, name="freshness_mobilenet_v3_small")

    def compile_model(rate: float) -> None:
        model.compile(optimizer=tf.keras.optimizers.Adam(rate),
                      loss=tf.keras.losses.SparseCategoricalCrossentropy(from_logits=True),
                      metrics=[tf.keras.metrics.SparseCategoricalAccuracy(name="accuracy")])

    def callbacks(stage: str) -> list:
        return [tf.keras.callbacks.ModelCheckpoint(str(args.run / f"{stage}.keras"), monitor="val_loss", save_best_only=True),
                tf.keras.callbacks.EarlyStopping(monitor="val_loss", patience=5, restore_best_weights=True),
                tf.keras.callbacks.ReduceLROnPlateau(monitor="val_loss", factor=0.5, patience=2, min_lr=1e-7),
                tf.keras.callbacks.CSVLogger(str(args.run / f"{stage}_history.csv")),
                tf.keras.callbacks.TerminateOnNaN()]

    print("Devices:", tf.config.list_physical_devices(), flush=True)
    compile_model(1e-3)
    model.fit(training, validation_data=validation, epochs=args.head_epochs,
              class_weight=weights, callbacks=callbacks("head"), shuffle=False, verbose=2)
    best_head = tf.keras.models.load_model(args.run / "head.keras")
    head_loss = float(best_head.evaluate(validation, verbose=0)[0])
    model.set_weights(best_head.get_weights())
    base.trainable = True
    for layer in base.layers[:-args.unfreeze_layers]:
        layer.trainable = False
    for layer in base.layers:
        if isinstance(layer, tf.keras.layers.BatchNormalization):
            layer.trainable = False
    compile_model(1e-5)
    model.fit(training, validation_data=validation, epochs=args.finetune_epochs,
              class_weight=weights, callbacks=callbacks("finetuned"), shuffle=False, verbose=2)
    fine = tf.keras.models.load_model(args.run / "finetuned.keras")
    fine_loss = float(fine.evaluate(validation, verbose=0)[0])
    selected = fine if fine_loss < head_loss else best_head
    selected.save(args.run / "model.keras")
    write_json(args.run / "selection.json", {"head_val_loss": head_loss, "finetuned_val_loss": fine_loss,
                                             "selected": "finetuned" if fine_loss < head_loss else "head",
                                             "model_sha256": file_hash(args.run / "model.keras")})
    print(f"Saved {args.run / 'model.keras'}. Next: evaluate.py. No test images were used for training.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=ROOT / "training_datasets")
    parser.add_argument("--manifest", type=Path, default=ROOT / "reports" / "prepared" / "manifest.csv")
    parser.add_argument("--run", type=Path, default=ROOT / "models" / "mobilenetv3-small-v1")
    parser.add_argument("--weights", default="imagenet", help="imagenet or a local MobileNetV3 Small no-top weights file")
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--head-epochs", type=int, default=10)
    parser.add_argument("--finetune-epochs", type=int, default=25)
    parser.add_argument("--unfreeze-layers", type=int, default=40)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    if min(args.batch_size, args.head_epochs, args.finetune_epochs, args.unfreeze_layers) < 1:
        parser.error("Batch size, epochs, and unfreeze layers must be positive")
    train(args)


if __name__ == "__main__":
    main()
