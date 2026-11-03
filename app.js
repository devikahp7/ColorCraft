
const form = document.getElementById("upload-form");
const input = document.getElementById("image-input");
const dropzone = document.getElementById("dropzone");
const previewWrap = document.getElementById("preview-wrap");
const preview = document.getElementById("preview");
const analyze = document.getElementById("analyze-btn");
const emptyState = document.getElementById("empty-state");
const resultState = document.getElementById("result-state");
const errorBox = document.getElementById("error-box");

const dominantContainer = document.getElementById("dominant-colors");
const paletteContainer = document.getElementById("color-palette");
const historyContainer = document.getElementById("history-list");
const copyPaletteButton = document.getElementById("copy-palette");
const exportCsvButton = document.getElementById("export-csv");

const colors = {
  red: "#dc232d",
  orange: "#f57d19",
  yellow: "#f5dc23",
  green: "#23aa4b",
  blue: "#2864dc",
  purple: "#9141be",
  black: "#191b20",
  white: "#eeeeea"
};

let selected = null;
let currentPalette = [];
let predictionHistory = [];

// ------------------------------
// Image upload and preview
// ------------------------------

function setFile(file) {
  errorBox.classList.add("hidden");

  if (!file) return;

  if (!file.type.startsWith("image/")) {
    showError("Please select an image file.");
    return;
  }

  if (file.size > 8 * 1024 * 1024) {
    showError("Image is too large. Maximum upload size is 8 MB.");
    return;
  }

  selected = file;
  preview.src = URL.createObjectURL(file);

  document.getElementById("filename").textContent = file.name;
  document.getElementById("filesize").textContent =
    (file.size / 1024).toFixed(1) + " KB";

  previewWrap.classList.remove("hidden");
  analyze.disabled = false;
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
}

input.addEventListener("change", event => {
  setFile(event.target.files[0]);
});

document.getElementById("remove-image").addEventListener("click", () => {
  selected = null;
  input.value = "";
  preview.removeAttribute("src");
  previewWrap.classList.add("hidden");
  analyze.disabled = true;
  errorBox.classList.add("hidden");
});

["dragenter", "dragover"].forEach(eventName => {
  dropzone.addEventListener(eventName, event => {
    event.preventDefault();
    dropzone.classList.add("dragover");
  });
});

["dragleave", "drop"].forEach(eventName => {
  dropzone.addEventListener(eventName, event => {
    event.preventDefault();
    dropzone.classList.remove("dragover");
  });
});

dropzone.addEventListener("drop", event => {
  setFile(event.dataTransfer.files[0]);
});

// ------------------------------
// Color helpers
// ------------------------------

function getColor(label) {
  return colors[String(label).toLowerCase()] || "#8b7cff";
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);

  if (className) {
    element.className = className;
  }

  if (text !== undefined) {
    element.textContent = text;
  }

  return element;
}

function showPlaceholder(container, message) {
  container.replaceChildren(
    makeElement("p", "placeholder", message)
  );
}

// ------------------------------
// CNN prediction display
// ------------------------------

function displayPrediction(result) {
  emptyState.classList.add("hidden");
  resultState.classList.remove("hidden");

  document.getElementById("result-label").textContent = result.label;
  document.getElementById("confidence").textContent =
    result.confidence + "%";

  document.getElementById("meter-fill").style.width =
    Math.max(0, Math.min(100, Number(result.confidence) || 0)) + "%";

  document.getElementById("color-swatch").style.background =
    getColor(result.label);

  const top3 = document.getElementById("top3");
  top3.replaceChildren();

  (result.top3 || []).forEach(item => {
    const row = makeElement("div", "top-item");
    const dot = document.createElement("i");

    dot.style.background = getColor(item.label);

    row.append(
      dot,
      makeElement("span", "", item.label),
      makeElement("strong", "", item.confidence + "%")
    );

    top3.appendChild(row);
  });
}

// ------------------------------
// Dominant color detection results
// ------------------------------

function displayDominantColors(dominantColors) {
  dominantContainer.replaceChildren();

  if (!dominantColors || dominantColors.length === 0) {
    showPlaceholder(dominantContainer, "No dominant colors were returned.");
    return;
  }

  dominantColors.forEach(color => {
    const card = makeElement("div", "color-card");
    const swatch = makeElement("div", "color-card-swatch");

    swatch.style.background = color.hex;

    const info = makeElement("div", "color-card-info");
    info.appendChild(makeElement("strong", "", color.hex));

    const rgb = Array.isArray(color.rgb)
      ? "RGB(" + color.rgb.join(", ") + ")"
      : "RGB unavailable";

    info.appendChild(makeElement("span", "", rgb));

    if (color.percentage !== null && color.percentage !== undefined) {
      info.appendChild(
        makeElement("span", "", color.percentage + "% of sampled pixels")
      );
    }

    card.append(swatch, info);
    dominantContainer.appendChild(card);
  });
}

// ------------------------------
// Generated palette
// ------------------------------

function displayPalette(palette) {
  currentPalette = Array.isArray(palette) ? palette : [];
  paletteContainer.replaceChildren();

  copyPaletteButton.disabled = currentPalette.length === 0;

  if (currentPalette.length === 0) {
    showPlaceholder(paletteContainer, "No palette was generated.");
    return;
  }

  currentPalette.forEach(color => {
    const item = makeElement("div", "palette-item");
    item.tabIndex = 0;
    item.setAttribute("role", "button");
    item.setAttribute("aria-label", "Copy " + color.hex);

    const swatch = makeElement("div", "palette-swatch");
    swatch.style.background = color.hex;

    const hex = makeElement("span", "palette-hex", color.hex);

    item.append(swatch, hex);

    const copyColor = async () => {
      try {
        await copyText(color.hex);
        showToast("Copied " + color.hex);
      } catch (error) {
        showError("Unable to copy the HEX code. Please copy it manually.");
      }
    };

    item.addEventListener("click", copyColor);

    item.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        copyColor();
      }
    });

    paletteContainer.appendChild(item);
  });
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";

  document.body.appendChild(textarea);
  textarea.select();

  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) {
    throw new Error("Copy failed");
  }
}

copyPaletteButton.addEventListener("click", async () => {
  if (currentPalette.length === 0) return;

  const hexCodes = currentPalette.map(color => color.hex).join(", ");

  try {
    await copyText(hexCodes);
    showToast("Palette HEX codes copied!");
  } catch (error) {
    showError("Unable to copy the palette. Please try again.");
  }
});

// ------------------------------
// Toast message
// ------------------------------

function showToast(message) {
  let toast = document.getElementById("colorcraft-toast");

  if (!toast) {
    toast = makeElement("div", "micro");
    toast.id = "colorcraft-toast";
    toast.setAttribute("role", "status");

    toast.style.marginTop = "12px";
    toast.style.color = "#69e2da";

    document.querySelector("main").appendChild(toast);
  }

  toast.textContent = message;
}

// ------------------------------
// Prediction history
// ------------------------------

function displayHistory(history) {
  predictionHistory = Array.isArray(history) ? history : [];
  historyContainer.replaceChildren();

  if (predictionHistory.length === 0) {
    showPlaceholder(
      historyContainer,
      "Your analyzed images will be listed here."
    );
    return;
  }

  [...predictionHistory].reverse().forEach(item => {
    const row = makeElement("div", "history-item");
    const details = makeElement("div", "history-details");

    details.appendChild(
      makeElement("strong", "", item.label || "Unknown")
    );

    details.appendChild(
      makeElement(
        "span",
        "",
        "Confidence: " + (item.confidence ?? "—") + "%"
      )
    );

    const timestamp = item.timestamp
      ? new Date(item.timestamp).toLocaleString()
      : "Time unavailable";

    details.appendChild(makeElement("span", "", timestamp));

    const chip = makeElement("div", "history-chip");
    const dominant = item.dominant_colors || [];

    chip.style.background =
      dominant.length > 0
        ? dominant[0].hex
        : getColor(item.label);

    chip.title = "Preview of the result color";

    row.append(details, chip);
    historyContainer.appendChild(row);
  });
}

async function loadHistory() {
  try {
    const response = await fetch("/history");

    if (!response.ok) {
      throw new Error("Could not load history.");
    }

    const data = await response.json();
    displayHistory(data.history || []);
  } catch (error) {
    showPlaceholder(historyContainer, "Unable to load prediction history.");
  }
}

// ------------------------------
// Export CSV
// ------------------------------

exportCsvButton.addEventListener("click", async () => {
  exportCsvButton.disabled = true;

  try {
    const response = await fetch("/export-csv");

    if (!response.ok) {
      throw new Error("CSV export failed.");
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "colorcraft_results.csv";

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
    showToast("CSV export downloaded!");
  } catch (error) {
    showError("Unable to export CSV. Please try again.");
  } finally {
    exportCsvButton.disabled = false;
  }
});

// ------------------------------
// Analyze image
// ------------------------------

form.addEventListener("submit", async event => {
  event.preventDefault();

  if (!selected) return;

  analyze.disabled = true;
  analyze.querySelector("span").textContent = "Analyzing…";
  errorBox.classList.add("hidden");

  const data = new FormData();
  data.append("image", selected);

  try {
    const response = await fetch("/predict", {
      method: "POST",
      body: data
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Prediction failed.");
    }

    // Keep the existing CNN prediction feature.
    displayPrediction(result);

    // Display the new color-analysis features.
    displayDominantColors(result.dominant_colors || []);
    displayPalette(result.palette || []);

    // Refresh history after each successful prediction.
    await loadHistory();

  } catch (error) {
    showError(error.message || "Something went wrong while analyzing the image.");
  } finally {
    analyze.disabled = !selected;
    analyze.querySelector("span").textContent = "Analyze color";
  }
});

// Load any history held by the current Flask session.
loadHistory();
