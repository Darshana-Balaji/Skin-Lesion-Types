"use strict";

async function model_processFile(file, imageSource) {
  if (!model) {
    throw new Error("The trained model is not ready.");
  }
  if (!file || !file.type.startsWith("image/")) {
    throw new Error("Choose a supported image file.");
  }
  if (!imageSource) {
    throw new Error("The selected image preview is not ready.");
  }

  const image = await loadImageSource(imageSource);
  const outputTensor = tf.tidy(() => {
    const inputTensor = tf.browser.fromPixels(image, 3)
      .resizeNearestNeighbor([224, 224])
      .toFloat()
      .sub(127.5)
      .div(127.5)
      .expandDims();
    const output = model.predict(inputTensor);
    if (Array.isArray(output) || !output || typeof output.data !== "function") {
      throw new Error("The trained model returned an unsupported output.");
    }
    return output;
  });

  let scores;
  try {
    scores = Array.from(await outputTensor.data());
  } finally {
    outputTensor.dispose();
  }

  if (scores.length !== modelClassNames.length || scores.some((score) => !Number.isFinite(score))) {
    throw new Error("The model returned invalid classification scores.");
  }

  const rankedScores = scores
    .map((score, index) => ({ className: modelClassNames[index], score }))
    .sort((first, second) => second.score - first.score);

  return {
    filename: file.name,
    imageSource: URL.createObjectURL(file),
    imageBlob: file,
    rankedScores
  };
}

function loadImageSource(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The browser could not decode the selected image."));
    image.src = source;
  });
}
