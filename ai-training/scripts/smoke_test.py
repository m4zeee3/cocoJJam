"""Exercise train/save/calibrate/evaluate/predict on synthetic images, without downloads.

This tests software integration only; its accuracy is meaningless.
"""
from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

from common import ROOT
from evaluate import evaluate
from train import train


def main() -> None:
    (ROOT / "reports").mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="synthetic-smoke-", dir=ROOT / "reports") as temporary:
        root = Path(temporary)
        rng = np.random.default_rng(42)
        labels = ["beef/fresh", "beef/spoiled", "chicken/fresh", "chicken/spoiled",
                  "fish/eye-fresh", "fish/eye-non-fresh", "fish/gill-fresh", "fish/gill-non-fresh",
                  "pork/fresh", "pork/spoiled"]
        rows = []
        for split in ("train", "val", "calibration", "test"):
            for i, label in enumerate(labels):
                name = f"{split}-{i}.png"
                Image.fromarray(rng.integers(0, 256, (48, 64, 3), dtype=np.uint8)).save(root / name)
                rows.append({"path": name, "label": label, "split": split, "group": name, "sha256": name})
        manifest = root / "manifest.csv"
        with manifest.open("w", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
        run = root / "run"
        train(argparse.Namespace(data=root, manifest=manifest, run=run, seed=42, batch_size=10,
                                 weights=None, head_epochs=1, finetune_epochs=1, unfreeze_layers=4))
        evaluate(argparse.Namespace(data=root, manifest=manifest, run=run, batch_size=10,
                                    output=None, target_accuracy=0.9, min_accepted=30))
        report = json.loads((run / "evaluation" / "report.json").read_text())
        assert report["calibrated"]["count"] == 10
        assert report["confidence_threshold"] is None
        subprocess.run([sys.executable, str(ROOT / "scripts" / "predict.py"), str(root / "test-0.png"),
                        "--run", str(run)], check=True)
    print("Synthetic integration test passed. No real model was trained or exported.")


if __name__ == "__main__":
    main()
