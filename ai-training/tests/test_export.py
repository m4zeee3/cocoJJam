"""Regression tests for exported TFLite probability contracts."""
from __future__ import annotations

import sys
import tempfile
import unittest
import csv
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from export_tflite import validate_probabilities
from validate_phone_photos import read_phone_manifest


class ExportProbabilityTests(unittest.TestCase):
    def test_accepts_finite_probability_rows(self):
        validate_probabilities(np.array([[0.25, 0.75], [1.0, 0.0]]), 2, 2)

    def test_rejects_wrong_output_shape(self):
        with self.assertRaisesRegex(ValueError, "Expected 2 rows and 3 classes"):
            validate_probabilities(np.array([[0.2, 0.8]]), 2, 3)

    def test_rejects_non_finite_probabilities(self):
        with self.assertRaisesRegex(ValueError, "non-finite"):
            validate_probabilities(np.array([[np.nan, 0.0]]), 1, 2)

    def test_rejects_non_normalized_probabilities(self):
        with self.assertRaisesRegex(ValueError, "do not sum to 1"):
            validate_probabilities(np.array([[0.25, 0.25]]), 1, 2)


class PhonePhotoManifestTests(unittest.TestCase):
    def write_manifest(self, path: Path, row: dict[str, str]) -> None:
        with path.open("w", newline="", encoding="utf-8") as stream:
            writer = csv.DictWriter(stream, fieldnames=("path", "label", "group_id"))
            writer.writeheader()
            writer.writerow(row)

    def test_accepts_relative_photo_path_and_known_label(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "photo.jpg").touch()
            manifest = root / "labels.csv"
            self.write_manifest(manifest, {"path": "photo.jpg", "label": "beef/fresh", "group_id": "sample-1"})
            rows = read_phone_manifest(manifest, root, ["beef/fresh", "beef/spoiled"])
            self.assertEqual(rows[0]["label"], "beef/fresh")
            self.assertEqual(rows[0]["group_id"], "sample-1")

    def test_rejects_unknown_label(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "photo.jpg").touch()
            manifest = root / "labels.csv"
            self.write_manifest(manifest, {"path": "photo.jpg", "label": "beef/unknown", "group_id": "sample-1"})
            with self.assertRaisesRegex(ValueError, "Unknown label"):
                read_phone_manifest(manifest, root, ["beef/fresh", "beef/spoiled"])

    def test_rejects_paths_outside_photo_root(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "photos"
            root.mkdir()
            manifest = Path(temporary) / "labels.csv"
            outside = Path(temporary) / "other.jpg"
            outside.touch()
            self.write_manifest(manifest, {"path": "..\\other.jpg", "label": "beef/fresh", "group_id": "sample-1"})
            with self.assertRaisesRegex(ValueError, "outside photo root"):
                read_phone_manifest(manifest, root, ["beef/fresh"])


if __name__ == "__main__":
    unittest.main()
