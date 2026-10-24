"use strict";

const viewButtons = Array.from(document.querySelectorAll("[data-view]"));
const viewNavLinks = Array.from(document.querySelectorAll(".nav-link[data-view]"));
const views = Array.from(document.querySelectorAll(".view-section"));
const pageTitle = document.getElementById("current-page");
const patientForm = document.getElementById("patient-form");
const imageInput = document.getElementById("image-selector");
const imagePreview = document.getElementById("selected-image");
const resultImage = document.getElementById("result-image");
const previewWrap = document.getElementById("image-preview-wrap");
const fileSummary = document.getElementById("file-summary");
const dropzone = document.getElementById("dropzone");
const appStatusElement = document.getElementById("app-status");
const analyzeButton = document.getElementById("analyze-button");

const DATABASE_NAME = "skinassess-local-records";
const DATABASE_VERSION = 2;
const RECORD_STORE = "analyses";
const ACCOUNT_STORE = "accounts";
const PBKDF2_ITERATIONS = 310000;
const ACCOUNT_CHECK = "skinassess-local-account-v1";
const CLASS_GUIDANCE = {
  "Actinic keratoses": {
    context: "This category includes actinic keratoses and intraepithelial lesions.",
    action: "Arrange a professional skin evaluation. A dermatologist can assess the area and discuss whether a local procedure or prescription treatment is appropriate."
  },
  "Basal cell carcinoma": {
    context: "This category is associated with basal cell carcinoma.",
    action: "Arrange a prompt appointment with a qualified healthcare professional or dermatologist. They can assess the area and discuss whether a diagnostic biopsy or treatment is appropriate."
  },
  "Dermatofibroma": {
    context: "Dermatofibromas are commonly benign skin nodules.",
    action: "Discuss a new or changing nodule with a healthcare professional, especially if it becomes painful or bleeds. They can advise whether observation or removal is appropriate."
  },
  "Benign keratosis-like lesions": {
    context: "This category groups several types of keratosis-like skin lesions.",
    action: "Discuss the spot with a healthcare professional if it is new, changing, irritated, or bleeding. They can advise whether monitoring or treatment is appropriate."
  },
  "Melanoma": {
    context: "This category is associated with melanoma, a serious skin condition that needs timely professional attention.",
    action: "Contact a qualified healthcare professional or dermatologist promptly for an in-person assessment. They can determine whether a biopsy or other care is appropriate."
  },
  "Melanocytic nevi": {
    context: "This category is associated with melanocytic moles.",
    action: "Continue routine skin checks and arrange professional evaluation for a new spot or one changing in shape, colour, or size, or becoming painful or bleeding."
  },
  "Vascular lesions": {
    context: "This category includes different types of vascular skin lesions.",
    action: "Discuss a new or changing spot with a healthcare professional, particularly if it bleeds repeatedly or becomes painful. They can advise whether treatment is appropriate."
  }
};
const viewNames = {
  intake: "Login",
  dashboard: "Dashboard",
  results: "Analysis result",
  history: "Previous analyses"
};

let currentPreviewUrl = "";
let previewReadPromise = Promise.resolve();
let previewSelection = 0;
let currentResult;
let currentResultUrl = "";
let historyDatabasePromise;
let currentPatientDetails = null;
let currentAccountId = null;
let accountCryptoKey = null;
let authMode = "login";
let legacyHistoryCount = 0;

const intakeForm = document.getElementById("patient-intake-form");
const intakeStatus = document.getElementById("intake-status");
const authSubmit = document.getElementById("auth-submit");
const doctorFields = document.getElementById("doctor-fields");
const createAccountFields = Array.from(document.querySelectorAll(".create-account-field"));
const doctorAssessmentInputs = Array.from(
  intakeForm.querySelectorAll('input[name="doctorAssessment"]')
);
const doctorDetailInputs = Array.from(
  doctorFields.querySelectorAll("input")
);

function updateDoctorFields() {
  const assessmentProvided = authMode === "create" &&
    intakeForm.elements.doctorAssessment.value === "Yes";
  doctorFields.hidden = !assessmentProvided;
  doctorDetailInputs.forEach((input) => {
    input.required = assessmentProvided;
    input.disabled = !assessmentProvided;
    if (!assessmentProvided) input.value = "";
  });
}

function setAuthMode(mode) {
  authMode = mode;
  const creatingAccount = mode === "create";
  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    const isActive = button.dataset.authMode === mode;
    button.classList.toggle("button-primary", isActive);
    button.classList.toggle("button-outline", !isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
  createAccountFields.forEach((field) => {
    field.hidden = !creatingAccount;
    field.querySelectorAll("input").forEach((input) => {
      input.disabled = !creatingAccount;
      input.required = creatingAccount;
    });
  });
  intakeForm.elements.password.autocomplete = creatingAccount ? "new-password" : "current-password";
  document.getElementById("intake-title").textContent =
    creatingAccount ? "Create your local account" : "Login";
  document.querySelector(".form-card .section-heading h2").textContent =
    creatingAccount ? "Patient details and account password" : "Sign in to your account";
  authSubmit.textContent = creatingAccount ? "Create account and continue" : "Login";
  document.getElementById("legacy-history-notice").hidden = legacyHistoryCount === 0;
  document.getElementById("import-legacy-consent").hidden = !creatingAccount;
  if (legacyHistoryCount > 0) {
    document.getElementById("legacy-history-text").textContent = creatingAccount
      ? `${legacyHistoryCount} record(s) have no account owner. Confirm they belong to you before encrypting and importing them, or delete them.`
      : `${legacyHistoryCount} older record(s) are not encrypted. They will not be shown in account history; you can delete them here.`;
  }
  updateDoctorFields();
}

document.querySelectorAll("[data-auth-mode]").forEach((button) => {
  button.addEventListener("click", () => setAuthMode(button.dataset.authMode));
});

doctorAssessmentInputs.forEach((input) => {
  input.addEventListener("change", updateDoctorFields);
});

intakeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!intakeForm.reportValidity()) return;

  authSubmit.disabled = true;
  intakeStatus.textContent = authMode === "create"
    ? "Creating and encrypting your local account…"
    : "Unlocking your local account…";
  try {
    const formData = new FormData(intakeForm);
    if (authMode === "create") {
      const password = formData.get("password");
      if (password !== formData.get("passwordConfirm")) {
        throw new Error("The passwords do not match.");
      }
      if (legacyHistoryCount > 0 &&
          !document.getElementById("import-legacy-history").checked) {
        throw new Error("Confirm that the existing local records belong to you before importing them, or delete the unclaimed records.");
      }
      await createLocalAccount(formData);
    } else {
      await loginToLocalAccount(
        formData.get("patientName"),
        formData.get("phoneNumber"),
        formData.get("password")
      );
    }
    await enterPatientWorkspace();
  } catch (error) {
    console.error("Local account access failed:", error);
    intakeStatus.textContent = error.message;
  } finally {
    authSubmit.disabled = false;
  }
});

document.getElementById("delete-legacy-history").addEventListener("click", async () => {
  if (!window.confirm("Permanently delete all previous local analyses that are not associated with an account? This cannot be undone.")) return;
  try {
    await deleteLegacyHistoryRecords();
    legacyHistoryCount = 0;
    document.getElementById("legacy-history-notice").hidden = true;
    document.getElementById("import-legacy-history").checked = false;
    intakeStatus.textContent = "Unclaimed local analyses were deleted.";
  } catch (error) {
    console.error("Could not delete unclaimed local analyses:", error);
    intakeStatus.textContent = "Unclaimed local analyses could not be deleted.";
  }
});

document.getElementById("lock-account").addEventListener("click", lockAccount);
document.getElementById("dashboard-lock-account").addEventListener("click", lockAccount);

function lockAccount() {
  accountCryptoKey = null;
  currentAccountId = null;
  currentPatientDetails = null;
  currentResult = null;
  if (currentResultUrl) URL.revokeObjectURL(currentResultUrl);
  currentResultUrl = "";
  if (currentPreviewUrl) URL.revokeObjectURL(currentPreviewUrl);
  currentPreviewUrl = "";
  imageInput.value = "";
  patientForm.reset();
  imagePreview.removeAttribute("src");
  imagePreview.hidden = true;
  previewWrap.hidden = true;
  fileSummary.textContent = "";
  document.getElementById("patient-summary").textContent = "";
  document.getElementById("welcome-patient-name").textContent = "Patient";
  document.getElementById("result-patient-details").replaceChildren();
  document.getElementById("report-body").replaceChildren();
  document.getElementById("prediction-list").replaceChildren();
  document.getElementById("prediction-title").textContent = "—";
  document.getElementById("prediction-score").textContent = "";
  document.getElementById("result-date").textContent = "";
  document.getElementById("report-reference").textContent = "";
  resultImage.removeAttribute("src");
  resultImage.hidden = true;
  document.getElementById("report-image").removeAttribute("src");
  document.getElementById("report-image").hidden = true;
  document.querySelectorAll(".history-list").forEach((list) => list.replaceChildren());
  document.getElementById("history-status").textContent = "";
  document.getElementById("dashboard-history-status").textContent = "";
  document.getElementById("history-empty").hidden = false;
  document.getElementById("dashboard-history-empty").hidden = false;
  document.getElementById("lock-account").hidden = true;
  intakeForm.reset();
  intakeStatus.textContent = "Your account is locked. Sign in to continue.";
  setAuthMode("login");
  showView("intake");
}

async function enterPatientWorkspace() {
  document.getElementById("welcome-patient-name").textContent =
    currentPatientDetails.patientName;
  document.getElementById("patient-summary").textContent =
    `${currentPatientDetails.phoneNumber} · ${currentPatientDetails.visitType}`;
  document.getElementById("lock-account").hidden = false;
  intakeForm.reset();
  setAuthMode("login");
  intakeStatus.textContent = "";
  showView("dashboard");
  await renderHistory();
}

function showView(viewName) {
  if (!viewNames[viewName]) return;
  if (viewName !== "intake" && (!accountCryptoKey || !currentPatientDetails)) {
    viewName = "intake";
  }

  views.forEach((view) => {
    const isVisible = view.id === `view-${viewName}`;
    view.hidden = !isVisible;
    view.classList.toggle("is-visible", isVisible);
  });
  viewNavLinks.forEach((button) => {
    const isActive = button.dataset.view === viewName;
    button.classList.toggle("is-active", isActive);
    if (isActive) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  pageTitle.textContent = viewNames[viewName];
  window.scrollTo({ top: 0, behavior: "smooth" });
}

viewButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.view === "intake" && accountCryptoKey) {
      lockAccount();
      return;
    }
    showView(button.dataset.view);
  });
});

document.getElementById("upload-button").addEventListener("click", () => imageInput.click());

imageInput.addEventListener("change", async () => {
  const selection = ++previewSelection;
  const file = imageInput.files[0];
  if (currentPreviewUrl) URL.revokeObjectURL(currentPreviewUrl);
  currentPreviewUrl = "";
  if (!file) {
    previewReadPromise = Promise.resolve();
    previewWrap.hidden = true;
    imagePreview.hidden = true;
    fileSummary.textContent = "";
    return;
  }

  previewWrap.hidden = false;
  fileSummary.textContent = file.name;
  imagePreview.hidden = true;
  currentPreviewUrl = URL.createObjectURL(file);
  const imageUrl = currentPreviewUrl;
  previewReadPromise = (async () => {
    try {
      await loadPreviewImage(imageUrl);
      if (selection !== previewSelection) return;
      appStatusElement.textContent = "Image preview ready. Submit the form to run the trained model.";
    } catch (error) {
      if (selection !== previewSelection) return;
      console.error("Image preview failed:", error);
      appStatusElement.textContent = "The selected image could not be previewed. Choose another image file.";
    }
  })();
  await previewReadPromise;
});

document.getElementById("remove-images").addEventListener("click", () => {
  previewSelection += 1;
  imageInput.value = "";
  if (currentPreviewUrl) URL.revokeObjectURL(currentPreviewUrl);
  currentPreviewUrl = "";
  previewReadPromise = Promise.resolve();
  imagePreview.removeAttribute("src");
  imagePreview.hidden = true;
  previewWrap.hidden = true;
  fileSummary.textContent = "";
  appStatusElement.textContent = "Image cleared. Select an image to continue.";
});

patientForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!patientForm.reportValidity()) return;

  const file = imageInput.files[0];
  if (!file || !file.type.startsWith("image/")) {
    appStatusElement.textContent = "Choose a supported image file before starting the analysis.";
    return;
  }
  if (!model) {
    appStatusElement.textContent = "The trained model is not ready. Wait for it to finish loading.";
    return;
  }

  analyzeButton.disabled = true;
  appStatusElement.textContent = "Running the model on this device…";
  try {
    await previewReadPromise;
    const prediction = await model_processFile(file, currentPreviewUrl);
    if (currentResultUrl) URL.revokeObjectURL(currentResultUrl);
    currentResultUrl = prediction.imageSource;
    currentResult = {
      id: createRecordId(),
      createdAt: new Date().toISOString(),
      patient: collectPatientDetails(),
      filename: prediction.filename,
      prediction: prediction.rankedScores,
      imageBlob: prediction.imageBlob
    };
    renderResult(currentResult, currentResultUrl);
    showView("results");

    try {
      await putHistoryRecord(currentResult);
      appStatusElement.textContent = "Analysis complete. Patient details, image, and result were encrypted and saved to this account's history.";
      await renderHistory();
    } catch (error) {
      console.error("Could not encrypt and save the analysis to local history:", error);
      appStatusElement.textContent =
        "Analysis complete, but encrypted history could not be saved. The result is available until the account is locked.";
    }
  } catch (error) {
    console.error("Image analysis failed:", error);
    appStatusElement.textContent = `Analysis could not be completed: ${error.message}`;
  } finally {
    analyzeButton.disabled = !model;
  }
});

dropzone.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dropzone.classList.add("is-dragging");
});

dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("is-dragging");
});

dropzone.addEventListener("dragleave", (event) => {
  if (!dropzone.contains(event.relatedTarget)) dropzone.classList.remove("is-dragging");
});

dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("is-dragging");
  const file = event.dataTransfer.files[0];
  if (!file) return;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  imageInput.files = transfer.files;
  imageInput.dispatchEvent(new Event("change", { bubbles: true }));
});

document.getElementById("print-report").addEventListener("click", () => window.print());

document.getElementById("clear-history").addEventListener("click", async () => {
  if (!window.confirm("Delete all saved analyses from this device? This cannot be undone.")) return;
  try {
    await clearHistoryRecords();
    await renderHistory();
  } catch (error) {
    console.error("Could not delete local analysis history:", error);
    setHistoryStatus("Saved analyses could not be deleted. Please try again.");
  }
});

document.querySelectorAll(".history-list").forEach((list) => {
  list.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-open-record]");
    if (!button) return;
    try {
      const record = await getHistoryRecord(button.dataset.openRecord);
      if (!record) throw new Error("The saved analysis could not be found.");
      currentResult = record;
      const imageUrl = URL.createObjectURL(record.imageBlob);
      if (currentResultUrl) URL.revokeObjectURL(currentResultUrl);
      currentResultUrl = imageUrl;
      renderResult(record, imageUrl);
      showView("results");
      appStatusElement.textContent = "Saved analysis opened from this device.";
    } catch (error) {
      console.error("Could not open saved analysis:", error);
      setHistoryStatus("This saved analysis could not be opened. It may have been removed or damaged.");
    }
  });
});

function collectPatientDetails() {
  if (!currentPatientDetails) {
    throw new Error("Log in before starting an analysis.");
  }
  const formData = new FormData(patientForm);
  return {
    ...currentPatientDetails,
    ageGroup: formData.get("ageGroup"),
    gender: formData.get("gender"),
    durationDays: formData.get("durationDays"),
    symptoms: formData.get("symptoms") || "Not provided",
    sensations: formData.getAll("sensation"),
    colors: formData.getAll("color"),
    sunAllergy: formData.get("sunAllergy"),
    geneticCondition: formData.get("geneticCondition") || "Not provided",
    lowImmunity: formData.get("lowImmunity"),
    medicalCondition: formData.get("medicalCondition") || "Not provided",
    skinChanges: formData.getAll("skinChange"),
    rapidGrowth: formData.get("rapidGrowth")
  };
}

function loadPreviewImage(source) {
  return new Promise((resolve, reject) => {
    const preview = new Image();
    preview.onload = () => {
      if (source === currentPreviewUrl) {
        imagePreview.src = source;
        imagePreview.hidden = false;
      }
      resolve();
    };
    preview.onerror = () => reject(new Error("The browser could not decode the selected image."));
    preview.src = source;
  });
}

function renderResult(record, imageSource) {
  const rankedScores = record.prediction;
  if (!Array.isArray(rankedScores) || rankedScores.length === 0) {
    throw new Error("The saved model result is missing its classification scores.");
  }

  document.getElementById("prediction-title").textContent = rankedScores[0].className;
  document.getElementById("prediction-score").textContent =
    `Model score: ${(rankedScores[0].score * 100).toFixed(1)}%`;
  document.getElementById("result-date").textContent =
    `${record.filename} · ${new Date(record.createdAt).toLocaleString()}`;
  resultImage.src = imageSource;
  resultImage.hidden = false;
  const reportImage = document.getElementById("report-image");
  reportImage.src = imageSource;
  reportImage.hidden = false;

  const scoreList = document.getElementById("prediction-list");
  scoreList.replaceChildren();
  rankedScores.slice(1, 4).forEach((item) => {
    const row = document.createElement("li");
    row.textContent = `${item.className}: ${(item.score * 100).toFixed(1)}% model score`;
    scoreList.appendChild(row);
  });

  const guidance = CLASS_GUIDANCE[rankedScores[0].className] || {
    context: "No category-specific information is available for this model output.",
    action: "Consult a qualified healthcare professional for an assessment."
  };
  document.getElementById("next-step-category").textContent =
    `Image classification: ${rankedScores[0].className}.`;
  document.getElementById("next-step-context").textContent = guidance.context;
  document.getElementById("next-step-action").textContent = guidance.action;

  renderDetails(document.getElementById("result-patient-details"), record.patient);
  document.getElementById("report-reference").textContent =
    `Reference: SA-${record.id} · ${new Date(record.createdAt).toLocaleString()}`;
  const reportBody = document.getElementById("report-body");
  reportBody.replaceChildren();
  appendReportSection(reportBody, "Model output", [
    ["Predicted category", rankedScores[0].className],
    ["Model score", `${(rankedScores[0].score * 100).toFixed(1)}%`],
    ["Image file", record.filename]
  ]);
  appendReportSection(reportBody, "Patient-provided information", patientDetailRows(record.patient));
  appendReportSection(reportBody, "General educational information and next steps", [
    ["Category context", guidance.context],
    ["Suggested next step", guidance.action],
    ["Clinical follow-up", "This is general educational information. A qualified healthcare professional can assess the lesion, provide a clinical diagnosis, and determine whether examination, biopsy, or treatment is appropriate."]
  ]);
}

function renderDetails(container, patient) {
  container.replaceChildren();
  patientDetailRows(patient).forEach(([label, value]) => {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    container.append(term, description);
  });
}

function patientDetailRows(patient) {
  return [
    ["Patient name", patient.patientName || "Not provided"],
    ["Phone number", patient.phoneNumber || "Not provided"],
    ["Visit type", patient.visitType || "Not provided"],
    ["Doctor assessment", patient.doctorAssessment || "Not provided"],
    ["Doctor name", patient.doctorName || "Not provided"],
    ["Doctor phone number", patient.doctorPhone || "Not provided"],
    ["Age group", patient.ageGroup],
    ["Gender", patient.gender],
    ["Duration (days)", patient.durationDays],
    ["Symptoms", patient.symptoms],
    ["Sensation", patient.sensations.join(", ") || "None selected"],
    ["Colour", patient.colors.join(", ") || "None selected"],
    ["Allergic to sun", patient.sunAllergy],
    ["Genetic condition", patient.geneticCondition],
    ["Low immunity", patient.lowImmunity],
    ["Medical condition", patient.medicalCondition],
    ["Bleeding / oozing / crusting", patient.skinChanges.join(", ") || "None selected"],
    ["Rapid growth", patient.rapidGrowth]
  ];
}

function appendReportSection(container, title, rows) {
  const section = document.createElement("section");
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.appendChild(heading);
  const details = document.createElement("dl");
  details.className = "details-list report-details";
  rows.forEach(([label, value]) => {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    details.append(term, description);
  });
  section.appendChild(details);
  container.appendChild(section);
}

function createRecordId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function requireWebCrypto() {
  if (!crypto.subtle || !crypto.getRandomValues) {
    throw new Error("Encrypted local accounts require a secure browser connection (HTTPS or localhost) with Web Crypto support.");
  }
}

function normalizePhoneNumber(phoneNumber) {
  const normalized = phoneNumber.replace(/\D/g, "");
  if (normalized.length < 7) throw new Error("Enter a valid phone number.");
  return normalized;
}

function createSalt() {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return salt;
}

async function deriveAccountKey(password, salt) {
  requireWebCrypto();
  const passwordMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    passwordMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptBytes(bytes, key, additionalData) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(additionalData) },
    key,
    bytes
  );
  return { iv, ciphertext };
}

async function decryptBytes(encrypted, key, additionalData) {
  return crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: encrypted.iv,
      additionalData: new TextEncoder().encode(additionalData)
    },
    key,
    encrypted.ciphertext
  );
}

async function encryptJSON(value, key, additionalData) {
  return encryptBytes(
    new TextEncoder().encode(JSON.stringify(value)),
    key,
    additionalData
  );
}

async function decryptJSON(encrypted, key, additionalData) {
  const plaintext = await decryptBytes(encrypted, key, additionalData);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

function accountProfileFromForm(formData) {
  return {
    patientName: formData.get("patientName").trim(),
    phoneNumber: formData.get("phoneNumber").trim(),
    visitType: formData.get("visitType"),
    doctorAssessment: formData.get("doctorAssessment"),
    doctorName: formData.get("doctorName") || "Not provided",
    doctorPhone: formData.get("doctorPhone") || "Not provided"
  };
}

async function encryptHistoryRecord(record, key, accountId) {
  const payload = { ...record };
  const imageBlob = payload.imageBlob;
  delete payload.imageBlob;
  const data = await encryptJSON(payload, key, `${accountId}:${record.id}:record`);
  const encryptedRecord = {
    id: record.id,
    owner: accountId,
    createdAt: record.createdAt,
    recordIv: data.iv,
    recordCiphertext: data.ciphertext
  };
  if (imageBlob instanceof Blob) {
    const image = await encryptBytes(
      await imageBlob.arrayBuffer(),
      key,
      `${accountId}:${record.id}:image`
    );
    encryptedRecord.imageType = imageBlob.type;
    encryptedRecord.imageIv = image.iv;
    encryptedRecord.imageCiphertext = image.ciphertext;
  }
  return encryptedRecord;
}

async function decryptHistoryRecord(encryptedRecord) {
  const record = await decryptJSON(
    { iv: encryptedRecord.recordIv, ciphertext: encryptedRecord.recordCiphertext },
    accountCryptoKey,
    `${currentAccountId}:${encryptedRecord.id}:record`
  );
  if (encryptedRecord.imageCiphertext) {
    const imageBytes = await decryptBytes(
      { iv: encryptedRecord.imageIv, ciphertext: encryptedRecord.imageCiphertext },
      accountCryptoKey,
      `${currentAccountId}:${encryptedRecord.id}:image`
    );
    record.imageBlob = new Blob([imageBytes], { type: encryptedRecord.imageType || "image/jpeg" });
  }
  return record;
}

async function createLocalAccount(formData) {
  const database = await openHistoryDatabase();
  const accountId = createRecordId();
  const salt = createSalt();
  const key = await deriveAccountKey(formData.get("password"), salt);
  const verification = await encryptJSON(
    ACCOUNT_CHECK,
    key,
    `${accountId}:verification`
  );
  const profile = await encryptJSON(
    accountProfileFromForm(formData),
    key,
    `${accountId}:profile`
  );
  const existingRecords = await getRawHistoryRecords();
  const legacyRecords = existingRecords.filter((record) => !record.owner);
  if (legacyRecords.length !== legacyHistoryCount) {
    throw new Error("The local history changed. Reload the page and review the records before creating the account.");
  }
  const encryptedLegacyRecords = await Promise.all(
    legacyRecords.map((record) => encryptHistoryRecord(record, key, accountId))
  );

  await new Promise((resolve, reject) => {
    const transaction = database.transaction([ACCOUNT_STORE, RECORD_STORE], "readwrite");
    transaction.objectStore(ACCOUNT_STORE).add({
      id: accountId,
      salt,
      verification,
      profile
    });
    const historyStore = transaction.objectStore(RECORD_STORE);
    encryptedLegacyRecords.forEach((record) => historyStore.put(record));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("Could not save the encrypted account."));
    transaction.onabort = () => reject(transaction.error || new Error("Account creation was cancelled."));
  });

  currentAccountId = accountId;
  accountCryptoKey = key;
  currentPatientDetails = accountProfileFromForm(formData);
}

async function loginToLocalAccount(patientName, phoneNumber, password) {
  requireWebCrypto();
  const accounts = await runStoreRequest(ACCOUNT_STORE, "readonly", (store) =>
    store.getAll()
  );
  if (accounts.length === 0) {
    throw new Error("No local account exists in this browser yet. Choose Create local account first.");
  }
  const normalizedName = patientName.trim().toLocaleLowerCase();
  const normalizedPhone = normalizePhoneNumber(phoneNumber);
  for (const account of accounts) {
    try {
      const key = await deriveAccountKey(password, account.salt);
      const verification = await decryptJSON(
        account.verification,
        key,
        `${account.id}:verification`
      );
      if (verification !== ACCOUNT_CHECK) continue;
      const profile = await decryptJSON(
        account.profile,
        key,
        `${account.id}:profile`
      );
      if (normalizePhoneNumber(profile.phoneNumber) !== normalizedPhone) continue;
      if (profile.patientName.trim().toLocaleLowerCase() !== normalizedName) continue;
      currentAccountId = account.id;
      accountCryptoKey = key;
      currentPatientDetails = profile;
      return;
    } catch {
      continue;
    }
  }
  throw new Error("Phone number or password is incorrect. Your account data remains encrypted.");
}

function openHistoryDatabase() {
  if (!("indexedDB" in window)) {
    return Promise.reject(new Error("This browser does not support local saved history."));
  }
  if (!historyDatabasePromise) {
    historyDatabasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(RECORD_STORE)) {
          database.createObjectStore(RECORD_STORE, { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains(ACCOUNT_STORE)) {
          database.createObjectStore(ACCOUNT_STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open local history."));
      request.onblocked = () => reject(new Error("Local history is blocked by another open app tab."));
    });
  }
  return historyDatabasePromise;
}

function runStoreRequest(storeName, mode, createRequest) {
  return openHistoryDatabase().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = createRequest(transaction.objectStore(storeName));
    let result;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error || new Error("Local account request failed."));
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error || new Error("Local account transaction failed."));
    transaction.onabort = () => reject(transaction.error || new Error("Local account transaction was cancelled."));
  }));
}

function runHistoryRequest(mode, createRequest) {
  return openHistoryDatabase().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(RECORD_STORE, mode);
    const request = createRequest(transaction.objectStore(RECORD_STORE));
    let result;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error || new Error("Local history request failed."));
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error || new Error("Local history transaction failed."));
    transaction.onabort = () => reject(transaction.error || new Error("Local history transaction was cancelled."));
  }));
}

async function putHistoryRecord(record) {
  if (!accountCryptoKey || !currentAccountId) {
    throw new Error("Unlock the account before saving analysis history.");
  }
  const encrypted = await encryptHistoryRecord(record, accountCryptoKey, currentAccountId);
  return runHistoryRequest("readwrite", (store) => store.put(encrypted));
}

async function getRawHistoryRecords() {
  return runHistoryRequest("readonly", (store) => store.getAll());
}

async function getAllHistoryRecords() {
  if (!currentAccountId || !accountCryptoKey) return [];
  const encryptedRecords = (await getRawHistoryRecords())
    .filter((record) => record.owner === currentAccountId);
  return Promise.all(encryptedRecords.map(decryptHistoryRecord));
}

async function getHistoryRecord(id) {
  const encrypted = await runHistoryRequest("readonly", (store) => store.get(id));
  if (!encrypted || encrypted.owner !== currentAccountId) return null;
  return decryptHistoryRecord(encrypted);
}

async function deleteLegacyHistoryRecords() {
  const records = await getRawHistoryRecords();
  const legacyIds = records.filter((record) => !record.owner).map((record) => record.id);
  await runHistoryRequest("readwrite", (store) => {
    legacyIds.forEach((id) => store.delete(id));
    return store.getAll();
  });
}

async function clearHistoryRecords() {
  const records = (await getRawHistoryRecords())
    .filter((record) => record.owner === currentAccountId)
    .map((record) => record.id);
  await runHistoryRequest("readwrite", (store) => {
    records.forEach((id) => store.delete(id));
    return store.getAll();
  });
}

async function renderHistory() {
  try {
    const records = (await getAllHistoryRecords())
      .sort((first, second) => second.createdAt.localeCompare(first.createdAt));
    renderHistoryList(document.getElementById("history-list"), records);
    renderHistoryList(document.getElementById("dashboard-history"), records.slice(0, 3));
    document.getElementById("history-empty").hidden = records.length > 0;
    document.getElementById("dashboard-history-empty").hidden = records.length > 0;
    setHistoryStatus("");
  } catch (error) {
    console.error("Could not load local analysis history:", error);
    setHistoryStatus("Saved history could not be loaded from this browser.");
  }
}

function setHistoryStatus(message) {
  document.getElementById("dashboard-history-status").textContent = message;
  document.getElementById("history-status").textContent = message;
}

function renderHistoryList(container, records) {
  container.replaceChildren();
  records.forEach((record) => {
    const button = document.createElement("button");
    button.className = "history-item";
    button.type = "button";
    button.dataset.openRecord = record.id;
    const heading = document.createElement("strong");
    heading.textContent = record.prediction[0]?.className || "Saved analysis";
    const details = document.createElement("span");
    details.textContent =
      `${new Date(record.createdAt).toLocaleString()} · ${record.filename} · Model score ${(record.prediction[0]?.score * 100).toFixed(1)}%`;
    button.append(heading, details);
    container.appendChild(button);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    legacyHistoryCount = (await getRawHistoryRecords()).filter((record) => !record.owner).length;
    if (legacyHistoryCount > 0) {
      document.getElementById("legacy-history-text").textContent =
        `${legacyHistoryCount} record(s) have no account owner. You can encrypt and import them after confirming they belong to you, or delete them.`;
    }
    setAuthMode("login");
  } catch (error) {
    console.error("Could not inspect local history:", error);
    intakeStatus.textContent = "Local account storage could not be opened in this browser.";
  }
});

const requiredCheckboxGroups = Array.from(
  patientForm.querySelectorAll("[data-require-one]")
);

function updateCheckboxGroupValidity(group) {
  const checkboxes = Array.from(group.querySelectorAll('input[type="checkbox"]'));
  const hasSelection = checkboxes.some((checkbox) => checkbox.checked);
  checkboxes[0].setCustomValidity(hasSelection ? "" : "Select at least one option.");
}

requiredCheckboxGroups.forEach((group) => {
  const checkboxes = Array.from(group.querySelectorAll('input[type="checkbox"]'));
  checkboxes.forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      if (checkbox.checked && checkbox.value === "None") {
        checkboxes.forEach((other) => {
          if (other !== checkbox) other.checked = false;
        });
      } else if (checkbox.checked) {
        const noneOption = checkboxes.find((other) => other.value === "None");
        if (noneOption) noneOption.checked = false;
      }
      updateCheckboxGroupValidity(group);
    });
  });
  updateCheckboxGroupValidity(group);
});
