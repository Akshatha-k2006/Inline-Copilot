"use client";

import { useEffect, useRef, useState } from "react";
import { API_URL, ApiError, api } from "@/lib/api";
import type { ContentImage } from "@/lib/types";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];

interface ImageAccessibilityPanelProps {
  contentId: number;
  canEdit: boolean;
  foregroundColor: string | null;
  backgroundColor: string | null;
  textSize: "normal" | "large" | null;
  onSaveContrast: (
    foregroundColor: string | null,
    backgroundColor: string | null,
    textSize: "normal" | "large" | null,
  ) => Promise<void>;
}

function imageUrl(image: ContentImage): string {
  return `${API_URL}${image.url}`;
}

export default function ImageAccessibilityPanel({
  contentId,
  canEdit,
  foregroundColor,
  backgroundColor,
  textSize,
  onSaveContrast,
}: ImageAccessibilityPanelProps) {
  const [images, setImages] = useState<ContentImage[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedPreview, setSelectedPreview] = useState("");
  const [altText, setAltText] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [contrastForeground, setContrastForeground] = useState(foregroundColor ?? "");
  const [contrastBackground, setContrastBackground] = useState(backgroundColor ?? "");
  const [contrastTextSize, setContrastTextSize] = useState<"normal" | "large">(
    textSize ?? "normal",
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const altInputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  useEffect(() => {
    let active = true;
    setImages([]);
    setSelectedFile(null);
    setError("");
    void api
      .listContentImages(contentId)
      .then((loaded) => {
        if (!active) return;
        setImages(loaded);
        setAltText(
          Object.fromEntries(loaded.map((image) => [image.id, image.alt_text])),
        );
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof ApiError
              ? cause.message
              : "Images could not be loaded.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [contentId]);

  useEffect(() => {
    setContrastForeground(foregroundColor ?? "");
    setContrastBackground(backgroundColor ?? "");
    setContrastTextSize(textSize ?? "normal");
  }, [foregroundColor, backgroundColor, textSize]);

  useEffect(
    () => () => {
      if (selectedPreview) URL.revokeObjectURL(selectedPreview);
    },
    [selectedPreview],
  );

  function chooseFile(file: File | undefined) {
    if (!file) return;
    setMessage("");
    setError("");
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setSelectedFile(null);
      setSelectedPreview("");
      setError("Unsupported file type. Choose a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setSelectedFile(null);
      setSelectedPreview("");
      setError("Image is too large. Choose a file no larger than 5 MB.");
      return;
    }
    if (selectedPreview) URL.revokeObjectURL(selectedPreview);
    setSelectedFile(file);
    setSelectedPreview(URL.createObjectURL(file));
  }

  async function upload() {
    if (!selectedFile || busy) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const image = await api.uploadContentImage(contentId, selectedFile);
      setImages((current) => [...current, image]);
      setAltText((current) => ({ ...current, [image.id]: image.alt_text }));
      setSelectedFile(null);
      setSelectedPreview("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      setMessage(`${image.filename} uploaded. Add alternative text below.`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The image upload failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveAltText(image: ContentImage) {
    if (savingId !== null) return;
    setSavingId(image.id);
    setMessage("");
    setError("");
    try {
      const updated = await api.updateContentImageAltText(
        image.id,
        altText[image.id] ?? "",
      );
      setImages((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setAltText((current) => ({ ...current, [updated.id]: updated.alt_text }));
      setMessage(`Alternative text saved for ${updated.filename}.`);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Alternative text could not be saved.",
      );
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="image-accessibility-panel" aria-labelledby="images-heading">
      <div>
        <p className="eyebrow">Accessibility</p>
        <h2 id="images-heading">Images</h2>
        <p className="muted">
          Alternative text should communicate the image&apos;s relevant
          information or purpose.
        </p>
      </div>
      {canEdit && (
        <div className="image-upload-controls">
          <label className="button" htmlFor="content-image-upload">
            Choose image
          </label>
          <input
            ref={fileInputRef}
            id="content-image-upload"
            className="visually-hidden"
            type="file"
            accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
            onChange={(event) => chooseFile(event.target.files?.[0])}
            disabled={busy}
          />
          {selectedFile && (
            <div className="image-ready">
              <span>{selectedFile.name} ready to upload</span>
              <button
                type="button"
                className="button button-primary"
                onClick={() => void upload()}
                disabled={busy}
              >
                {busy ? "Uploading..." : "Upload image"}
              </button>
            </div>
          )}
        </div>
      )}
      {message && (
        <p className="form-success" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {selectedPreview && (
        <div className="image-preview image-preview-pending">
          <img src={selectedPreview} alt="Selected image preview" />
          <span>Preview · not uploaded yet</span>
        </div>
      )}
      {images.length === 0 && !selectedPreview ? (
        <p className="muted">No image selected.</p>
      ) : (
        <div className="image-list">
          {images.map((image) => {
            const currentAlt = altText[image.id] ?? "";
            const missingAlt = !currentAlt.trim();
            return (
              <article className="image-item" key={image.id}>
                <div className="image-preview">
                  <img src={imageUrl(image)} alt={currentAlt} />
                  <span>{image.filename}</span>
                </div>
                <div className="image-alt-fields">
                  {missingAlt && (
                    <p className="accessibility-warning" role="alert">
                      Missing alternative text for {image.filename}. Add text
                      to communicate relevant image information to people using
                      assistive technology.
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => altInputRefs.current[image.id]?.focus()}
                      >
                        Add alt text
                      </button>
                    </p>
                  )}
                  <label className="form-field" htmlFor={`alt-text-${image.id}`}>
                    Alternative text (alt text)
                    <input
                      ref={(element) => {
                        altInputRefs.current[image.id] = element;
                      }}
                      id={`alt-text-${image.id}`}
                      value={currentAlt}
                      onChange={(event) =>
                        setAltText((current) => ({
                          ...current,
                          [image.id]: event.target.value,
                        }))
                      }
                      disabled={!canEdit || savingId === image.id}
                      placeholder="Describe the image's purpose"
                    />
                  </label>
                  {canEdit && (
                    <button
                      type="button"
                      className="button button-primary"
                      onClick={() => void saveAltText(image)}
                      disabled={savingId === image.id}
                    >
                      {savingId === image.id ? "Saving..." : "Save alt text"}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      <div className="contrast-controls">
        <div>
          <p className="eyebrow">Color contrast</p>
          <p className="muted">
            Optional WCAG AA check for the configured text colors. Enter actual
            colors to include this check in the next review.
          </p>
        </div>
        <div className="contrast-control-grid">
          <label className="form-field">
            Foreground color
            <input
              type="text"
              value={contrastForeground}
              onChange={(event) => setContrastForeground(event.target.value)}
              placeholder="#26323B"
              disabled={!canEdit}
            />
          </label>
          <label className="form-field">
            Background color
            <input
              type="text"
              value={contrastBackground}
              onChange={(event) => setContrastBackground(event.target.value)}
              placeholder="#FAF8F3"
              disabled={!canEdit}
            />
          </label>
          <label className="form-field">
            Text size
            <select
              value={contrastTextSize}
              onChange={(event) =>
                setContrastTextSize(event.target.value as "normal" | "large")
              }
              disabled={!canEdit}
            >
              <option value="normal">Normal text (4.5:1)</option>
              <option value="large">Large text (3:1)</option>
            </select>
          </label>
        </div>
        {canEdit && (
          <button
            type="button"
            className="button"
            onClick={() =>
              void onSaveContrast(
                contrastForeground.trim() || null,
                contrastBackground.trim() || null,
                contrastForeground.trim() && contrastBackground.trim()
                  ? contrastTextSize
                  : null,
              )
            }
          >
            Save color settings
          </button>
        )}
      </div>
    </section>
  );
}
