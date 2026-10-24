"use strict";

let model;
let modelClassNames = [];
const expectedClassNames = [
  "Actinic keratoses",
  "Basal cell carcinoma",
  "Benign keratosis-like lesions",
  "Dermatofibroma",
  "Melanoma",
  "Melanocytic nevi",
  "Vascular lesions"
];

const selectedImage = document.getElementById("selected-image");
const modelStatusElement = document.getElementById("app-status");

function setAppStatus(message) {
  modelStatusElement.dataset.modelState = message;
  modelStatusElement.textContent = navigator.onLine ? message : `${message} · Offline`;
}

async function loadTrainedModel() {
  setAppStatus("Loading the trained 7-class model…");
  const namesResponse = await fetch("./trained_model_7class/class_names.json");
  if (!namesResponse.ok) {
    throw new Error(`Could not load trained model class names: ${namesResponse.status}`);
  }

  const candidateClassNames = await namesResponse.json();
  if (JSON.stringify(candidateClassNames) !== JSON.stringify(expectedClassNames)) {
    throw new Error("Trained model class names do not match the expected seven classes.");
  }

  const candidate = await tf.loadLayersModel("./trained_model_7class/model.json");
  const inputShape = candidate.inputs[0].shape;
  const outputShape = candidate.outputs[0].shape;
  if (inputShape[1] !== 224 || inputShape[2] !== 224 || inputShape[3] !== 3 ||
      outputShape[outputShape.length - 1] !== candidateClassNames.length) {
    candidate.dispose();
    throw new Error("Trained model input or output dimensions do not match the expected image format.");
  }

  model = candidate;
  modelClassNames = candidateClassNames;
  setAppStatus("Trained 7-class model ready. Results are research model outputs, not diagnoses.");
}

(async function initializeApp() {
  try {
    await loadTrainedModel();
  } catch (error) {
    console.error("Trained model failed to load:", error);
    setAppStatus("The trained model could not be loaded. Check the connection and reload the app.");
  } finally {
    document.querySelector(".progress-bar").hidden = true;
  }
})();
