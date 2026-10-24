"""Fine-tune the reference model with seven supported classes and an unknown class."""

import argparse
import json
import sys
from types import ModuleType
from pathlib import Path

import numpy as np
import tensorflow as tf
from sklearn.metrics import classification_report, confusion_matrix

try:
    import tensorflow_decision_forests
except ModuleNotFoundError as error:
    if error.name != "tensorflow_decision_forests":
        raise
    # TFJS imports its SavedModel converter even though this Keras model uses no TFDF layers.
    sys.modules["tensorflow_decision_forests"] = ModuleType(
        "tensorflow_decision_forests"
    )

import tensorflowjs as tfjs


PROJECT_DIR = Path(__file__).resolve().parent
DEFAULT_DATASET = PROJECT_DIR.parents[1] / "archive"
DEFAULT_REFERENCE_MODEL = PROJECT_DIR / "final_model_kaggle_version1" / "model.json"
DEFAULT_OUTPUT = PROJECT_DIR / "trained_model_with_rejection"
IMAGE_SIZE = (224, 224)
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".gif"}
SELECTED_CLASSES = [
    "Actinic keratoses",
    "Basal cell carcinoma",
    "Benign keratosis-like lesions",
    "Dermatofibroma",
    "Melanoma",
    "Melanocytic nevi",
    "Vascular lesions",
]
OTHER_ARCHIVE_CLASSES = [
    "Chickenpox",
    "Cowpox",
    "Healthy",
    "HFMD",
    "Measles",
    "Monkeypox",
    "Squamous cell carcinoma",
]
OTHER_CLASS_NAME = "Other / unsupported"
OUTPUT_CLASS_NAMES = SELECTED_CLASSES + [OTHER_CLASS_NAME]
ARCHIVE_CLASSES = SELECTED_CLASSES + OTHER_ARCHIVE_CLASSES


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--reference-model", type=Path, default=DEFAULT_REFERENCE_MODEL)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--epochs", type=int, default=15)
    parser.add_argument("--fine-tune-epochs", type=int, default=10)
    parser.add_argument(
        "--head-learning-rate",
        type=float,
        default=1e-4,
        help="Learning rate for adapting the reference classifier head.",
    )
    parser.add_argument(
        "--max-train-images-per-class",
        type=int,
        help="Use a balanced sample per class for a quicker prototype run.",
    )
    parser.add_argument(
        "--max-eval-images-per-class",
        type=int,
        help="Limit validation and test samples per class for a quicker prototype run.",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Resume fine-tuning from the best_model.keras checkpoint.",
    )
    parser.add_argument("--seed", type=int, default=101)
    return parser.parse_args()


def inspect_splits(dataset_dir):
    classes_by_split = {}
    counts_by_split = {}
    image_ids_by_split = {}
    for split in ("train", "val", "test"):
        split_dir = dataset_dir / split
        if not split_dir.is_dir():
            raise FileNotFoundError(f"Missing dataset split: {split_dir}")

        available = {path.name for path in split_dir.iterdir() if path.is_dir()}
        missing = set(ARCHIVE_CLASSES) - available
        if missing:
            raise ValueError(
                f"Missing required archive class folders in {split_dir}: {sorted(missing)}"
            )

        classes_by_split[split] = OUTPUT_CLASS_NAMES
        counts_by_split[split] = {}
        image_ids_by_split[split] = set()
        for class_name in OUTPUT_CLASS_NAMES:
            source_classes = (
                OTHER_ARCHIVE_CLASSES
                if class_name == OTHER_CLASS_NAME
                else [class_name]
            )
            images = []
            for source_class in source_classes:
                class_dir = split_dir / source_class
                images.extend(
                    path
                    for path in class_dir.rglob("*")
                    if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
                )
            count = len(images)
            if count == 0:
                raise ValueError(
                    f"No supported images found for {class_name} in {split_dir}"
                )
            counts_by_split[split][class_name] = count
            image_ids_by_split[split].update(path.stem.casefold() for path in images)

    expected = OUTPUT_CLASS_NAMES
    for split, classes in classes_by_split.items():
        if classes != expected:
            raise ValueError(
                f"{split} class folders do not match train: "
                f"{sorted(set(expected) - set(classes))=}, "
                f"{sorted(set(classes) - set(expected))=}"
            )
    for first, second in (("train", "val"), ("train", "test"), ("val", "test")):
        overlap = image_ids_by_split[first] & image_ids_by_split[second]
        if overlap:
            examples = sorted(overlap)[:5]
            raise ValueError(
                f"Image IDs appear in both {first} and {second} splits "
                f"({len(overlap)} overlaps; examples: {examples})"
            )
    return expected, counts_by_split


def make_dataset(
    directory, class_names, batch_size, seed, shuffle, max_images_per_class=None
):
    image_paths = []
    labels = []
    rng = np.random.default_rng(seed)
    for class_index, class_name in enumerate(class_names):
        source_classes = (
            OTHER_ARCHIVE_CLASSES if class_name == OTHER_CLASS_NAME else [class_name]
        )
        class_images = []
        for source_class in source_classes:
            class_dir = directory / source_class
            class_images.extend(
                path
                for path in class_dir.rglob("*")
                if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
            )
        class_images.sort()
        if max_images_per_class is not None and len(class_images) > max_images_per_class:
            selected_indices = sorted(
                rng.choice(len(class_images), size=max_images_per_class, replace=False)
            )
            class_images = [class_images[index] for index in selected_indices]
        image_paths.extend(str(path) for path in class_images)
        labels.extend([class_index] * len(class_images))

    if not image_paths:
        raise ValueError(f"No supported images found in selected classes under {directory}")

    dataset = tf.data.Dataset.from_tensor_slices((image_paths, labels))
    if shuffle:
        dataset = dataset.shuffle(
            len(image_paths), seed=seed, reshuffle_each_iteration=True
        )

    def load_image(path, label):
        image = tf.io.decode_image(
            tf.io.read_file(path), channels=3, expand_animations=False
        )
        image.set_shape((None, None, 3))
        image = tf.image.resize(image, IMAGE_SIZE, method="nearest")
        return image, label

    dataset = dataset.map(load_image, num_parallel_calls=tf.data.AUTOTUNE)
    dataset = dataset.batch(batch_size)
    options = tf.data.Options()
    options.experimental_deterministic = not shuffle
    return dataset.with_options(options).prefetch(tf.data.AUTOTUNE)


def make_class_weights(dataset, class_count):
    counts = np.zeros(class_count, dtype=np.int64)
    for _, labels in dataset:
        counts += np.bincount(labels.numpy(), minlength=class_count)
    if np.any(counts == 0):
        raise ValueError(f"Training data has an empty class: {counts.tolist()}")
    total = int(counts.sum())
    weights = {
        index: float(total / (class_count * count))
        for index, count in enumerate(counts)
    }
    return weights


def prepare_datasets(train, validation, test):
    augmentation = tf.keras.Sequential(
        [
            tf.keras.layers.RandomFlip("horizontal"),
            tf.keras.layers.RandomRotation(0.05),
            tf.keras.layers.RandomZoom(0.08),
        ],
        name="training_augmentation",
    )

    def augment_and_normalize(images, labels):
        images = augmentation(images, training=True)
        images = tf.cast(images, tf.float32)
        return images / 127.5 - 1.0, labels

    def normalize(images, labels):
        images = tf.cast(images, tf.float32)
        return images / 127.5 - 1.0, labels

    train = train.map(
        augment_and_normalize, num_parallel_calls=tf.data.AUTOTUNE
    ).prefetch(tf.data.AUTOTUNE)
    validation = validation.map(
        normalize, num_parallel_calls=tf.data.AUTOTUNE
    ).prefetch(tf.data.AUTOTUNE)
    test = test.map(normalize, num_parallel_calls=tf.data.AUTOTUNE).prefetch(
        tf.data.AUTOTUNE
    )
    return train, validation, test


def build_model(reference_model_path, class_count, head_learning_rate):
    reference_model = tfjs.converters.load_keras_model(str(reference_model_path))
    reference_head = reference_model.layers[-1]
    if not isinstance(reference_head, tf.keras.layers.Dense):
        raise ValueError("Reference model must end with a Dense classification layer.")
    if (
        reference_head.units != len(SELECTED_CLASSES)
        or class_count != len(OUTPUT_CLASS_NAMES)
        or len(reference_head.get_weights()) != 2
    ):
        raise ValueError("Reference model output does not match the seven supported classes.")

    feature_layer = reference_model.get_layer("conv_pw_13_relu")
    backbone = tf.keras.Model(
        inputs=reference_model.input,
        outputs=feature_layer.output,
        name="reference_mobilenet_backbone",
    )
    backbone.trainable = False

    inputs = tf.keras.Input(shape=(*IMAGE_SIZE, 3), name="image")
    x = backbone(inputs, training=False)
    x = tf.keras.layers.GlobalAveragePooling2D()(x)
    x = tf.keras.layers.Dropout(0.3)(x)
    outputs = tf.keras.layers.Dense(
        class_count, activation="softmax", name="predictions"
    )(x)
    model = tf.keras.Model(inputs, outputs, name="skin_lesion_with_rejection")
    reference_kernel, reference_bias = reference_head.get_weights()
    unknown_kernel = np.zeros((reference_kernel.shape[0], 1), dtype=reference_kernel.dtype)
    unknown_bias = np.zeros((1,), dtype=reference_bias.dtype)
    model.get_layer("predictions").set_weights(
        [
            np.concatenate([reference_kernel, unknown_kernel], axis=1),
            np.concatenate([reference_bias, unknown_bias]),
        ]
    )
    compile_model(model, learning_rate=head_learning_rate)
    return model, backbone


def compile_model(model, learning_rate):
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=learning_rate),
        loss="sparse_categorical_crossentropy",
        metrics=[
            tf.keras.metrics.SparseCategoricalAccuracy(name="accuracy"),
            tf.keras.metrics.SparseTopKCategoricalAccuracy(k=3, name="top_3_accuracy"),
        ],
    )


def make_callbacks(checkpoint_path):
    return [
        tf.keras.callbacks.ModelCheckpoint(
            str(checkpoint_path),
            monitor="val_loss",
            save_best_only=True,
        ),
        tf.keras.callbacks.EarlyStopping(
            monitor="val_loss",
            patience=4,
            restore_best_weights=True,
        ),
        tf.keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss",
            factor=0.2,
            patience=2,
            min_lr=1e-6,
        ),
    ]


def main():
    args = parse_args()
    if args.batch_size < 1 or args.epochs < 1 or args.fine_tune_epochs < 0:
        raise ValueError("Batch size and epochs must be positive; fine-tune epochs cannot be negative.")
    if args.head_learning_rate <= 0:
        raise ValueError("Head learning rate must be positive.")
    if (args.max_train_images_per_class is not None
            and args.max_train_images_per_class < 1):
        raise ValueError("Maximum training images per class must be positive.")
    if (args.max_eval_images_per_class is not None
            and args.max_eval_images_per_class < 1):
        raise ValueError("Maximum evaluation images per class must be positive.")
    if not args.reference_model.is_file():
        raise FileNotFoundError(f"Reference model not found: {args.reference_model}")

    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "model-info.json").write_text(
        json.dumps(
            {
                "available": False,
                "class_count": len(OUTPUT_CLASS_NAMES),
                "status": "Training or evaluation review is pending.",
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    tf.keras.utils.set_random_seed(args.seed)
    class_names, split_counts = inspect_splits(args.dataset)
    print(f"Classes ({len(class_names)}): {class_names}")
    for split, counts in split_counts.items():
        print(f"{split} image counts: {counts}")
    for class_name, count in split_counts["test"].items():
        if count < 30:
            print(
                f"WARNING: {class_name} has only {count} test images; "
                "per-class test metrics will be uncertain."
            )

    train = make_dataset(
        args.dataset / "train", class_names, args.batch_size, args.seed, True,
        args.max_train_images_per_class,
    )
    validation = make_dataset(
        args.dataset / "val", class_names, args.batch_size, args.seed, False,
        args.max_eval_images_per_class,
    )
    test = make_dataset(
        args.dataset / "test", class_names, args.batch_size, args.seed, False,
        args.max_eval_images_per_class,
    )
    class_weights = make_class_weights(train, len(class_names))
    train, validation, test = prepare_datasets(train, validation, test)

    checkpoint_path = args.output / "best_model.keras"
    if args.resume:
        if not checkpoint_path.is_file():
            raise FileNotFoundError(f"Checkpoint not found: {checkpoint_path}")
        model = tf.keras.models.load_model(checkpoint_path)
        backbone = model.get_layer("reference_mobilenet_backbone")
    else:
        model, backbone = build_model(
            args.reference_model, len(class_names), args.head_learning_rate
        )
    callbacks = make_callbacks(checkpoint_path)

    if not args.resume:
        model.fit(
            train,
            validation_data=validation,
            epochs=args.epochs,
            class_weight=class_weights,
            callbacks=callbacks,
        )

    if args.fine_tune_epochs:
        backbone.trainable = True
        for layer in backbone.layers[:-20]:
            layer.trainable = False
        for layer in backbone.layers:
            if isinstance(layer, tf.keras.layers.BatchNormalization):
                layer.trainable = False
        compile_model(model, learning_rate=1e-5)
        model.fit(
            train,
            validation_data=validation,
            epochs=args.fine_tune_epochs,
            class_weight=class_weights,
            callbacks=callbacks,
        )

    best_model = tf.keras.models.load_model(checkpoint_path)
    test_loss, test_accuracy, test_top_3_accuracy = best_model.evaluate(
        test, verbose=0
    )
    probabilities = best_model.predict(test, verbose=0)
    true_labels = np.concatenate([labels.numpy() for _, labels in test])
    predicted_labels = probabilities.argmax(axis=1)
    report = classification_report(
        true_labels,
        predicted_labels,
        labels=range(len(class_names)),
        target_names=class_names,
        output_dict=True,
        zero_division=0,
    )
    matrix = confusion_matrix(
        true_labels, predicted_labels, labels=range(len(class_names))
    )

    tfjs.converters.save_keras_model(best_model, str(args.output))
    (args.output / "class_names.json").write_text(
        json.dumps(class_names, indent=2) + "\n", encoding="utf-8"
    )
    (args.output / "model-info.json").write_text(
        json.dumps(
            {
                "available": False,
                "class_count": len(class_names),
                "status": "Review evaluation.json before enabling this model.",
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    (args.output / "evaluation.json").write_text(
        json.dumps(
            {
                "reference_model": str(args.reference_model),
                "dataset": str(args.dataset),
                "test_loss": float(test_loss),
                "test_accuracy": float(test_accuracy),
                "test_top_3_accuracy": float(test_top_3_accuracy),
                "class_names": class_names,
                "split_counts": split_counts,
                "training_images_per_class_limit": args.max_train_images_per_class,
                "evaluation_images_per_class_limit": args.max_eval_images_per_class,
                "head_learning_rate": args.head_learning_rate,
                "classification_report": report,
                "confusion_matrix": matrix.tolist(),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    checkpoint_path.unlink()
    print(f"Saved browser model and class names in: {args.output}")
    print(
        f"Held-out test accuracy={test_accuracy:.4f}; "
        f"top-3 accuracy={test_top_3_accuracy:.4f}"
    )
    print("Review evaluation.json before enabling this model for users.")


if __name__ == "__main__":
    main()
