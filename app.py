
from pathlib import Path
import io
import csv
import json
import colorsys
from datetime import datetime, timezone

import numpy as np
import tensorflow as tf
from PIL import Image, UnidentifiedImageError
from flask import Flask, render_template, request, jsonify, Response


# --------------------------------------------------
# Flask application and configuration
# --------------------------------------------------

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024

BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "models" / "colorcraft_cnn.keras"
LABEL_PATH = BASE_DIR / "models" / "labels.json"

_model = None
_labels = None

# Recent predictions are stored in memory.
PREDICTION_HISTORY = []
MAX_HISTORY = 100


# --------------------------------------------------
# Load the trained CNN model and class labels
# --------------------------------------------------

def load_model():
    global _model, _labels

    if _model is not None:
        return True

    if not MODEL_PATH.is_file() or not LABEL_PATH.is_file():
        return False

    try:
        model = tf.keras.models.load_model(MODEL_PATH)

        labels = json.loads(
            LABEL_PATH.read_text(encoding="utf-8")
        )

        # Support either a list of labels or a dictionary
        # whose keys are numeric class indices.
        if isinstance(labels, dict):
            labels = [
                labels[str(i)] if str(i) in labels else labels[i]
                for i in range(len(labels))
            ]

        if not isinstance(labels, list) or not labels:
            raise ValueError("The labels file must contain class labels.")

        _model = model
        _labels = labels
        return True

    except (OSError, ValueError, KeyError, TypeError) as exc:
        app.logger.exception("Could not load the CNN model or labels: %s", exc)
        return False


# --------------------------------------------------
# Extract dominant colors from an image
# --------------------------------------------------

def extract_dominant_colors(image, limit=5):
    sample = image.copy()
    sample.thumbnail((150, 150))

    quantized = sample.quantize(
        colors=limit,
        method=Image.Quantize.MEDIANCUT
    )

    counts = quantized.getcolors(150 * 150) or []
    counts.sort(reverse=True)

    color_table = quantized.getpalette()

    if not color_table:
        return []

    total_pixels = sample.width * sample.height
    dominant_colors = []

    for pixels, palette_index in counts[:limit]:
        start = palette_index * 3
        rgb = color_table[start:start + 3]

        if len(rgb) != 3:
            continue

        hex_code = "#{:02X}{:02X}{:02X}".format(*rgb)

        dominant_colors.append({
            "hex": hex_code,
            "rgb": list(rgb),
            "percentage": round(pixels / total_pixels * 100, 2)
        })

    return dominant_colors


# --------------------------------------------------
# Generate a palette of five related colors
# --------------------------------------------------

def generate_palette(dominant_colors, limit=5):
    palette = []
    seen = set()

    # Start with the actual dominant colors.
    for color in dominant_colors:
        if color["hex"] not in seen:
            palette.append(dict(color))
            seen.add(color["hex"])

        if len(palette) >= limit:
            return palette

    if not dominant_colors:
        return palette

    # Generate additional shades based on the leading color.
    r, g, b = [
        value / 255 for value in dominant_colors[0]["rgb"]
    ]

    hue, lightness, saturation = colorsys.rgb_to_hls(r, g, b)

    for new_lightness in (0.20, 0.35, 0.50, 0.65, 0.80, 0.95):
        rr, gg, bb = colorsys.hls_to_rgb(
            hue, new_lightness, saturation
        )

        rgb = [round(value * 255) for value in (rr, gg, bb)]
        hex_code = "#{:02X}{:02X}{:02X}".format(*rgb)

        if hex_code in seen:
            continue

        palette.append({
            "hex": hex_code,
            "rgb": rgb,
            "percentage": None
        })
        seen.add(hex_code)

        if len(palette) >= limit:
            break

    return palette


# --------------------------------------------------
# Main website
# --------------------------------------------------

@app.get("/")
def index():
    ready = load_model()

    return render_template(
        "index.html",
        model_ready=ready
    )


# --------------------------------------------------
# Predict image color category
# --------------------------------------------------

@app.post("/predict")
def predict():
    if not load_model():
        return jsonify({
            "error": (
                "The CNN model or labels could not be loaded. "
                "Check models/colorcraft_cnn.keras and "
                "models/labels.json."
            )
        }), 503

    file = request.files.get("image")

    if not file or not file.filename:
        return jsonify({
            "error": "Please choose an image first."
        }), 400

    try:
        # Read the uploaded image.
        with Image.open(io.BytesIO(file.read())) as uploaded:
            original_image = uploaded.convert("RGB")

        # Extract dominant colors and generate the palette.
        dominant_colors = extract_dominant_colors(original_image)
        palette = generate_palette(dominant_colors)

        # Keep the original CNN input size and preprocessing.
        model_image = original_image.resize((96, 96))
        arr = np.asarray(model_image, dtype=np.float32) / 255.0

    except (UnidentifiedImageError, OSError, ValueError):
        return jsonify({
            "error": (
                "That file could not be read as an image. "
                "Try a valid JPG or PNG image."
            )
        }), 400

    try:
        probabilities = np.asarray(
            _model.predict(
                np.expand_dims(arr, axis=0),
                verbose=0
            )[0]
        )

        if (
            probabilities.ndim != 1
            or len(probabilities) != len(_labels)
            or len(probabilities) == 0
            or not np.all(np.isfinite(probabilities))
        ):
            raise ValueError(
                "The model output does not match the class labels."
            )

        order = np.argsort(probabilities)[::-1][:3]

        result = {
            "label": _labels[int(order[0])],
            "confidence": round(
                float(probabilities[order[0]]) * 100, 2
            ),
            "top3": [
                {
                    "label": _labels[int(i)],
                    "confidence": round(
                        float(probabilities[i]) * 100, 2
                    )
                }
                for i in order
            ],
            "dominant_colors": dominant_colors,
            "palette": palette,
            "timestamp": datetime.now(timezone.utc).isoformat(
                timespec="seconds"
            )
        }

    except (ValueError, IndexError, TypeError):
        app.logger.exception("CNN prediction failed.")

        return jsonify({
            "error": (
                "Prediction failed. Please check that the trained "
                "model and labels match, then try again."
            )
        }), 500

    except Exception:
        app.logger.exception("Unexpected error during prediction.")

        return jsonify({
            "error": "An unexpected prediction error occurred."
        }), 500

    # Save the result for history and CSV export.
    PREDICTION_HISTORY.append(result)

    # Retain only the most recent MAX_HISTORY results.
    if len(PREDICTION_HISTORY) > MAX_HISTORY:
        del PREDICTION_HISTORY[:-MAX_HISTORY]

    return jsonify(result)


# --------------------------------------------------
# Prediction history endpoint
# --------------------------------------------------

@app.get("/history")
def history():
    return jsonify({
        "history": PREDICTION_HISTORY
    })


# --------------------------------------------------
# Export prediction history to CSV
# --------------------------------------------------

@app.get("/export-csv")
def export_csv():
    output = io.StringIO()
    writer = csv.writer(output)

    writer.writerow([
        "Timestamp",
        "Predicted Color",
        "Confidence (%)",
        "Dominant Colors",
        "Palette HEX Codes"
    ])

    for item in PREDICTION_HISTORY:
        dominant = ", ".join(
            color["hex"]
            for color in item.get("dominant_colors", [])
        )

        palette = ", ".join(
            color["hex"]
            for color in item.get("palette", [])
        )

        writer.writerow([
            item.get("timestamp", ""),
            item.get("label", ""),
            item.get("confidence", ""),
            dominant,
            palette
        ])

    response = Response(
        output.getvalue(),
        mimetype="text/csv; charset=utf-8"
    )

    response.headers["Content-Disposition"] = (
        "attachment; filename=colorcraft_results.csv"
    )

    return response


# --------------------------------------------------
# Handle images exceeding the 8 MB upload limit
# --------------------------------------------------

@app.errorhandler(413)
def too_large(_error):
    return jsonify({
        "error": "Image is too large. Maximum upload size is 8 MB."
    }), 413


# --------------------------------------------------
# Run the application
# --------------------------------------------------

if __name__ == "__main__":
    app.run(debug=True)
