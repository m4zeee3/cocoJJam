# Freshness training: MobileNetV3 Small

Local training and evaluation for UC-1.4. Images stay on this computer. The scripts
do not upload images, contact the backend, convert to TFLite, or change app assets.
The first use of `--weights imagenet` downloads pretrained weights; afterward the
cached weights work offline. Alternatively pass a local no-top weights file.

## Labels and input

One model predicts these **10 joint food/freshness classes**, preserving the dataset labels:

| Food/view | Labels |
| --- | --- |
| Beef | `beef/fresh`, `beef/spoiled` |
| Chicken | `chicken/fresh`, `chicken/spoiled` |
| Pork | `pork/fresh`, `pork/spoiled` |
| Fish eyes | `fish/eye-fresh`, `fish/eye-non-fresh` |
| Fish gills | `fish/gill-fresh`, `fish/gill-non-fresh` |

This classifies a single image. Fish eye and gill photos should be close-ups matching
the training data. It does not locate/crop eyes or gills or combine two views into
one fish-level assessment. There is no unknown-food class; unfamiliar subjects can
still receive high confidence, so uncertainty handling is not an out-of-distribution detector.

Input: EXIF-oriented RGB, bilinear resize/stretch to **224 x 224**, float32 values
**0–255**. MobileNetV3 includes its own rescaling. Do **not** divide by 255.
The saved `.keras` model outputs logits, in the exact order of `labels.json`.
Calibrated probabilities are `softmax(logits / temperature)`.

## Run in PowerShell

From `ai-training/`, with the virtual environment activated:

```powershell
python -m pip install -r requirements.txt
python scripts/prepare.py
python scripts/train.py
python scripts/evaluate.py
python scripts/predict.py "C:\path\to\new-photo.jpg"
```

Run each command only after the preceding command succeeds. Python 3.11 is the
repository baseline; the current environment has Python 3.13 and TensorFlow 2.20.
TensorFlow will print its detected devices. Batch size defaults to 32; reduce it
with `--batch-size 16` if memory is limited. Full CPU training can take substantial time.
If `reports/prepared/manifest.csv` already exists, start with `train.py`; preparation
intentionally refuses to overwrite an existing split manifest.

### Audit before training

Expected input: `training_datasets/<food>_freshness/{train,val,test}/<label>/*`.
`prepare.py` decodes images, detects identical RGB pixels even across food categories,
groups Roboflow `.rf.` variants by source filename, and checks split overlap.
It writes `reports/prepared/audit.json` before refusing invalid data. Contradictory
labels and unreadable images must be resolved; a higher confidence threshold cannot fix them.

If there are only split overlaps, create a new manifest with:

```powershell
python scripts/prepare.py --rebuild-splits
```

This **does not move, delete, or relabel source images**. It keeps one copy of each
pixel-identical image and assigns entire groups to approximately 70% train,
10% validation, 10% calibration, 10% test, stratified by class. It replaces the
original benchmark split assignments, including test assignments; results cannot
be compared directly with scores on the original test split. Each class needs at
least 10 independent groups. Counts may vary because groups have different sizes.

Without rebuilding, original train/test assignments are preserved and validation
is divided into validation and calibration groups. Existing manifests cannot be
overwritten; use `--output reports/prepared-v2` and pass its `--manifest` to training
and evaluation for a new experiment.

Filename/hash grouping cannot identify every near-duplicate, burst sequence, or
multiple photos of the same animal/sample. Supply a CSV with `path,group_id` using
paths relative to `training_datasets/` to keep all views of a specimen/session together:

```powershell
python scripts/prepare.py --groups-csv specimen_groups.csv --rebuild-splits
```

When available, also hold out suppliers, capture sessions and devices. Review
backgrounds, watermarks, lighting, source provenance and labeling methods. A model
can learn dataset identity instead of freshness. Keep independent phone photos for
a final real-world check. Do not tune repeatedly against the same test set.

### Training and model selection

Training uses ImageNet transfer learning, balanced class weights, modest geometric
augmentation, dropout, early stopping and learning-rate reduction. First it trains
the classification head for up to 10 epochs, then fine-tunes the last 40 backbone
layers for up to 25 epochs at a smaller learning rate. Batch normalization stays
frozen and the backbone is called in inference mode. The better checkpoint is
selected using **validation loss only**. Calibration/test images never train weights.

```powershell
python scripts/train.py --run models/experiment-02 --head-epochs 10 --finetune-epochs 25
python scripts/evaluate.py --run models/experiment-02 --target-accuracy 0.90 --min-accepted 30
python scripts/predict.py "C:\path\to\photo.jpg" --run models/experiment-02
```

Choose a new `--run` for each experiment. Models, histories, seed, manifest hash,
TensorFlow version and label order are saved under that run. Do not change images
after preparation; if the dataset changes, prepare a new manifest and retrain.

## Accuracy and confidence review before TFLite

`evaluate.py` fits a scalar temperature using **calibration data only**, then selects
a confidence threshold on that split. The default target is a 90% lower bound on
accepted-image accuracy (Wilson 95% interval), with at least 30 accepted calibration
examples. This is a configurable selection criterion, **not a promised test accuracy**.
If none meets the criterion, the threshold is `null` and all predictions are uncertain.
Temperature scaling adjusts confidence without changing the predicted class ranking.

The frozen temperature and threshold are then applied to held-out test images:

| Artifact in `models/<run>/evaluation/` | What to inspect |
| --- | --- |
| `report.json` | Accuracy and its interval, macro F1, per-class precision/recall/F1, food/view breakdowns, false-fresh counts, accepted accuracy and coverage |
| `predictions.csv` | Every image's true/predicted labels, raw/calibrated confidence, top 3 and uncertain/accepted decision |
| `confusion_matrix.png` | Which food/freshness classes are confused |
| `reliability.png` | Whether predicted confidence matches observed correctness |
| `calibration.json` | Temperature, threshold, calibration metrics and model/manifest hashes |

Report raw and calibrated NLL, Brier score and expected calibration error (15 bins),
not just mean confidence. A 99% softmax score is not evidence of 99% accuracy.
Check spoiled/non-fresh images classified as fresh, every food/view separately,
sample sizes, and how much coverage is lost at the threshold. Aggregate accuracy
can hide poor chicken or fish performance. Wilson intervals here are per image;
correlated images within groups can make them optimistic. Threshold selection also
reuses calibration data, so only untouched test results assess its generalization.

High accuracy cannot be guaranteed by an architecture or training settings. It must
be measured on independently labeled, representative data. The model estimates
visual freshness and must not be presented as a food-safety certification.

### Float16 TFLite export and validation

After reviewing every class, false-fresh errors and independent phone-photo results,
export the evaluated run:

```powershell
python scripts/export_tflite.py --run models/mobilenetv3-small-v2
```

The export refuses mismatched model, labels or manifest hashes and never overwrites
a non-empty output directory. It writes `model.tflite`, the unchanged `labels.json`,
`deployment.json`, and `validation.json` under
`models/mobilenetv3-small-v2/tflite-float32-v1/`. The default float32 export keeps
the evaluated model's weights and has float32 I/O. To compare the smaller float16
weight variant, use `--precision float16`; each precision writes to a separate
versioned directory. Both return `softmax(logits / calibration temperature)`
probabilities. The validation runs the converted model over the held-out test split
and compares its probabilities, class/threshold decisions, accuracy, per-class
results and false-fresh counts against the saved Keras test evaluation. This is a
conversion-regression check, not a new independent test or a reason to tune against
the test set.

For a separately captured phone photo, run the exported model locally:

```powershell
python scripts/predict_tflite.py "C:\path\to\phone-photo.jpg" --export models/mobilenetv3-small-v2/tflite-float32-v1
```

The command prints the top three model classes and marks predictions below the
calibration threshold uncertain. Review predictions against independently known
labels before considering deployment. Photos remain on this computer.

To quantify an independent, manually labeled phone-photo set, create a CSV with
`path,label` columns and optionally `group_id` (same specimen/session gets one ID).
Labels must exactly match the exported model classes; paths are relative to `--data`.
For example:

```csv
path,label,group_id
phone-photos/beef-01.jpg,beef/fresh,beef-sample-01
phone-photos/fish-eye-01.jpg,fish/eye-non-fresh,fish-sample-01
```

Then run:

```powershell
python scripts/validate_phone_photos.py --manifest phone_labels.csv --data . --export models/mobilenetv3-small-v2/tflite-float32-v1 --output reports/phone-validation.json
```

Assign labels independently of the model predictions. Include varied products,
lighting and phone cameras; repeated photos of one specimen do not count as
independent examples. Do not use this photo set to tune thresholds and then claim
it as an untouched evaluation set.

The export keeps the model's exact classes (`beef/fresh`, `fish/eye-non-fresh`,
and so on); it does not translate them into app stages. App integration must use
the exported `labels.json` order, feed 224x224 RGB raw 0–255 pixels resized with
bilinear stretch, interpret output as calibrated probabilities, and apply the
saved confidence threshold. The app may adapt its scan stages to these model
classes later. A model result is a visual estimate, not food-safety certification.

## Verify the pipeline

```powershell
python -m unittest discover -s tests -v
python scripts/smoke_test.py
```

The smoke test runs both training stages, saving/loading, calibration, evaluation,
plots and single-image prediction with synthetic images and random initial weights.
It downloads nothing and its classification scores are meaningless. Temporary
synthetic artifacts are removed; it never creates the production training run.

Implementation references: [Keras MobileNetV3 input contract](https://keras.io/api/applications/mobilenet/),
[TensorFlow transfer learning](https://www.tensorflow.org/guide/keras/transfer_learning),
and [Guo et al., temperature scaling](https://proceedings.mlr.press/v70/guo17a.html).
