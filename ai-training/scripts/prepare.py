"""Audit local images and write a reproducible, group-isolated CSV manifest."""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image, ImageOps
from sklearn.model_selection import StratifiedGroupKFold

ROOT = Path(__file__).resolve().parents[1]
CLASSES = {
    "beef_freshness": ["fresh", "spoiled"],
    "chicken_freshness": ["fresh", "spoiled"],
    "fish_freshness": ["eye-fresh", "eye-non-fresh", "gill-fresh", "gill-non-fresh"],
    "pork_freshness": ["fresh", "spoiled"],
}
EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def source_key(dataset: str, path: Path) -> str:
    # Roboflow assigns different suffixes to augmentations of the same source.
    return dataset + "/" + path.stem.split(".rf.")[0].casefold()


def scan(root: Path, overrides: dict[str, str]) -> tuple[list[dict], list[dict]]:
    rows, bad = [], []
    decoded = {}

    def inspect(path: Path) -> tuple[str | None, str | None]:
        try:
            contents = path.read_bytes()
            byte_hash = hashlib.sha256(contents).hexdigest()
            if byte_hash not in decoded:
                with Image.open(io.BytesIO(contents)) as image:
                    rgb = ImageOps.exif_transpose(image).convert("RGB")
                    decoded[byte_hash] = hashlib.sha256(str(rgb.size).encode() + rgb.tobytes()).hexdigest()
            return decoded[byte_hash], None
        except (OSError, ValueError) as error:
            return None, str(error)

    for dataset, labels in CLASSES.items():
        for split in ("train", "val", "test"):
            for label in labels:
                folder = root / dataset / split / label
                print(f"Scanning {dataset}/{split}/{label}", flush=True)
                if not folder.is_dir():
                    raise ValueError(f"Missing class folder: {folder}")
                paths = [p for p in sorted(folder.rglob("*")) if p.is_file() and p.suffix.lower() in EXTENSIONS]
                with ThreadPoolExecutor(max_workers=4) as pool:
                    for path, (digest, error) in zip(paths, pool.map(inspect, paths)):
                        relative = path.relative_to(root).as_posix()
                        if error:
                            bad.append({"path": relative, "error": error})
                            continue
                        rows.append({
                            "path": relative, "label": dataset.removesuffix("_freshness") + "/" + label,
                            "original_split": split, "sha256": digest,
                            "source": source_key(dataset, path),
                            "specimen": overrides.get(relative, ""),
                        })
    return rows, bad


def group_rows(rows: list[dict]) -> None:
    parents = list(range(len(rows)))

    def find(i: int) -> int:
        while parents[i] != i:
            parents[i] = parents[parents[i]]
            i = parents[i]
        return i

    seen = {}
    for i, row in enumerate(rows):
        keys = [("pixels", row["sha256"]), ("source", row["source"])]
        if row["specimen"]:
            keys.append(("specimen", row["specimen"]))
        for key in keys:
            if key in seen:
                parents[find(i)] = find(seen[key])
            else:
                seen[key] = i
    for i, row in enumerate(rows):
        row["group"] = f"group-{find(i):06d}"


def make_splits(rows: list[dict], rebuild: bool, seed: int) -> None:
    selected = rows if rebuild else [r for r in rows if r["original_split"] == "val"]
    folds = 10 if rebuild else 2
    labels = sorted({r["label"] for r in rows})
    for label in labels:
        count = len({r["group"] for r in selected if r["label"] == label})
        if count < folds:
            raise ValueError(f"{label}: need at least {folds} independent groups; found {count}")
    splitter = StratifiedGroupKFold(n_splits=folds, shuffle=True, random_state=seed)
    for row in rows:
        row["split"] = row["original_split"]
    for fold, (_, indices) in enumerate(splitter.split(
        selected, [r["label"] for r in selected], [r["group"] for r in selected]
    )):
        split = ({0: "test", 1: "val", 2: "calibration"}.get(fold, "train")
                 if rebuild else ("val" if fold == 0 else "calibration"))
        for i in indices:
            selected[i]["split"] = split
    for split in ("train", "val", "calibration", "test"):
        absent = set(labels) - {r["label"] for r in rows if r["split"] == split}
        if absent:
            raise ValueError(f"{split} is missing {sorted(absent)}; collect more groups or change seed")


def prepare(args: argparse.Namespace) -> None:
    if (args.output / "manifest.csv").exists():
        raise ValueError("Output already contains a manifest. Use a new --output directory.")
    args.output.mkdir(parents=True, exist_ok=True)
    overrides = {}
    if args.groups_csv:
        with args.groups_csv.open(newline="", encoding="utf-8-sig") as stream:
            for row in csv.DictReader(stream):
                key = row["path"].replace("\\", "/")
                if not row["group_id"].strip() or key in overrides:
                    raise ValueError(f"Empty or duplicate specimen mapping: {key}")
                overrides[key] = row["group_id"].strip()
    rows, bad = scan(args.data.resolve(), overrides)
    if set(overrides) - {r["path"] for r in rows}:
        raise ValueError("Specimen mappings contain paths not found among readable images")
    group_rows(rows)
    by_hash, by_group = defaultdict(list), defaultdict(list)
    for row in rows:
        by_hash[row["sha256"]].append(row)
        by_group[row["group"]].append(row)
    conflicts = [v for v in by_hash.values() if len({r["label"] for r in v}) > 1]
    leaks = [v for v in by_group.values() if len({r["original_split"] for r in v}) > 1]
    report = {
        "images": len(rows), "unreadable": bad,
        "original_counts": dict(sorted(Counter(r["original_split"] + "/" + r["label"] for r in rows).items())),
        "duplicate_pixels": sum(len(v) - 1 for v in by_hash.values()),
        "conflicting_label_groups": [[{"path": r["path"], "label": r["label"]} for r in v] for v in conflicts],
        "cross_split_groups": [[r["path"] for r in v] for v in leaks],
        "seed": args.seed, "rebuilt_splits": args.rebuild_splits,
        "grouping": "RGB pixel hash + Roboflow source filename + optional specimen IDs",
        "limitation": "Does not detect all near-duplicates or separate views of one specimen. Supply specimen IDs.",
    }
    audit = args.output / "audit.json"
    audit.write_text(json.dumps(report, indent=2), encoding="utf-8")
    if conflicts:
        with (args.output / "label_conflicts.csv").open("w", newline="", encoding="utf-8") as stream:
            writer = csv.DictWriter(stream, fieldnames=["sha256", "label", "path"], extrasaction="ignore")
            writer.writeheader()
            writer.writerows(row for conflict in conflicts for row in conflict)
    print(f"Images: {len(rows)}; duplicate pixels: {report['duplicate_pixels']}; "
          f"conflicting labels: {len(conflicts)}; groups crossing splits: {len(leaks)}", flush=True)
    print(f"Audit: {audit}", flush=True)
    if bad or conflicts:
        raise ValueError("Unreadable images or contradictory labels found. Resolve audit.json entries before training.")
    if leaks and not args.rebuild_splits:
        raise ValueError("Data leakage found. Review audit.json; use --rebuild-splits to create new isolated splits.")
    # Keep one copy of each pixel-identical image, without modifying the source data.
    unique = [v[0].copy() for v in by_hash.values()]
    make_splits(unique, args.rebuild_splits, args.seed)
    fields = ["path", "label", "split", "group", "sha256", "original_split"]
    with (args.output / "manifest.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(unique)
    report["final_counts"] = dict(sorted(Counter(r["split"] + "/" + r["label"] for r in unique).items()))
    audit.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report["final_counts"], indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=ROOT / "training_datasets")
    parser.add_argument("--output", type=Path, default=ROOT / "reports" / "prepared")
    parser.add_argument("--groups-csv", type=Path, help="Optional path,group_id CSV for specimen/session grouping")
    parser.add_argument("--rebuild-splits", action="store_true", help="Replace original split assignments in the manifest only")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    try:
        prepare(args)
    except ValueError as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
