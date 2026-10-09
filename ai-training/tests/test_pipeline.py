"""Regression tests for leakage prevention and confidence reporting."""
from __future__ import annotations

import csv
import argparse
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from scipy.special import softmax
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from common import choose_threshold, fit_temperature, metrics, nll, read_manifest, selective, wilson
from prepare import group_rows, make_splits, prepare, source_key


class ConfidenceTests(unittest.TestCase):
    def test_temperature_reduces_overconfidence_without_changing_ranking(self):
        logits = np.array([[8., 0.]] * 8 + [[0., 8.]] * 2)
        targets = np.zeros(10, dtype=int)
        temperature = fit_temperature(logits, targets)
        self.assertGreater(temperature, 1)
        self.assertLess(nll(logits, targets, temperature), nll(logits, targets, 1))
        np.testing.assert_array_equal(logits.argmax(1), softmax(logits / temperature, axis=1).argmax(1))

    def test_no_supported_threshold_abstains(self):
        probabilities = np.array([[0.99, 0.01]] * 50)
        targets = np.ones(50, dtype=int)
        threshold = choose_threshold(targets, probabilities, 0.9, 30)
        self.assertIsNone(threshold)
        result = selective(targets, probabilities, threshold)
        self.assertEqual(result["coverage"], 0)
        self.assertIsNone(result["accuracy"])

    def test_threshold_excludes_low_confidence_errors(self):
        probabilities = np.array([[0.99, 0.01]] * 100 + [[0.55, 0.45]] * 100)
        targets = np.array([0] * 100 + [1] * 100)
        threshold = choose_threshold(targets, probabilities, 0.9, 30)
        self.assertAlmostEqual(threshold, 0.99)
        self.assertEqual(selective(targets, probabilities, threshold)["coverage"], 0.5)
        self.assertIsNone(choose_threshold(targets[:10], probabilities[:10], 0.9, 30))

    def test_confidence_one_is_included_and_absent_classes_are_reported(self):
        result = metrics(np.array([0, 0]), np.array([[1., 0.], [1., 0.]]), ["beef/fresh", "fish/eye-fresh"], None)
        self.assertEqual(result["reliability_bins"][-1]["count"], 2)
        self.assertEqual(result["expected_calibration_error"], 0)
        self.assertEqual(result["classification_report"]["fish/eye-fresh"]["support"], 0)
        self.assertIsNone(wilson(0, 0))
        self.assertLess(wilson(10, 10)[0], 0.9)


class LeakageTests(unittest.TestCase):
    def test_conflicting_pixels_block_training_and_produce_reviewable_audit(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for split in ("train", "val", "test"):
                for label in ("fresh", "spoiled"):
                    folder = root / "data" / "beef_freshness" / split / label
                    folder.mkdir(parents=True)
                    Image.new("RGB", (8, 8), (25, 50, 75)).save(folder / "same.png")
            args = argparse.Namespace(data=root / "data", output=root / "audit", groups_csv=None,
                                      rebuild_splits=True, seed=42)
            with patch("prepare.CLASSES", {"beef_freshness": ["fresh", "spoiled"]}):
                with self.assertRaisesRegex(ValueError, "contradictory labels"):
                    prepare(args)
            report = json.loads((root / "audit" / "audit.json").read_text())
            self.assertEqual(report["duplicate_pixels"], 5)
            self.assertEqual(len(report["conflicting_label_groups"]), 1)
            self.assertFalse((root / "audit" / "manifest.csv").exists())
            self.assertTrue((root / "audit" / "label_conflicts.csv").exists())

    def test_grouping_is_transitive_across_hash_source_and_specimen(self):
        rows = [
            {"sha256": "a", "source": "one", "specimen": ""},
            {"sha256": "b", "source": "one", "specimen": "fish1"},
            {"sha256": "b", "source": "two", "specimen": ""},
            {"sha256": "c", "source": "three", "specimen": "fish1"},
            {"sha256": "d", "source": "four", "specimen": ""},
        ]
        group_rows(rows)
        self.assertEqual(len({r["group"] for r in rows[:4]}), 1)
        self.assertNotEqual(rows[0]["group"], rows[4]["group"])
        self.assertEqual(source_key("beef", Path("fresh.rf.abc.jpg")), source_key("beef", Path("fresh.rf.xyz.jpg")))

    def test_rebuild_is_deterministic_and_never_splits_a_group(self):
        rows = [{"label": label, "group": f"{label}-{i}", "original_split": "train"}
                for label in ("fresh", "spoiled") for i in range(40) for _ in range(2)]
        other = [r.copy() for r in rows]
        make_splits(rows, True, 42)
        make_splits(other, True, 42)
        self.assertEqual(rows, other)
        for group in {r["group"] for r in rows}:
            self.assertEqual(len({r["split"] for r in rows if r["group"] == group}), 1)
        self.assertEqual({r["split"] for r in rows}, {"train", "val", "calibration", "test"})

    def test_manifest_rejects_cross_split_group_leakage(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            rows = []
            for i, split in enumerate(("train", "val", "calibration", "test")):
                (root / f"{i}.jpg").touch()
                rows.append({"path": f"{i}.jpg", "label": "fresh", "split": split,
                             "group": "same-specimen", "sha256": str(i)})
            path = root / "manifest.csv"
            with path.open("w", newline="") as stream:
                writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
                writer.writeheader()
                writer.writerows(rows)
            with self.assertRaisesRegex(ValueError, "leakage"):
                read_manifest(path, root)


if __name__ == "__main__":
    unittest.main()
