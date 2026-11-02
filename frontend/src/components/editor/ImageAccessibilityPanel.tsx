"use client";

import { useEffect, useRef, useState } from "react";
import { API_URL, ApiError, api } from "@/lib/api";
import type { ContentImage, ContrastCheckResponse } from "@/lib/types";

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
  const [imagesLoading, setImagesLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedPreview, setSelectedPreview] = useState("");
  const [altText, setAltText] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [contrastForeground, setContrastForeground] = useState(
    foregroundColor ?? "#26323B",
  );
  const [contrastBackground, setContrastBackground] = useState(
    backgroundColor ?? "#FAF8F3",
  );
  const [contrastTextSize, setContrastTextSize] = useState<"normal" | "large">(
    textSize ?? "normal",
  );
  const [contrastResult, setContrastResult] =
    useState<ContrastCheckResponse | null>(null);
  const [checkingContrast, setCheckingContrast] = useState(false);
  const [contrastError, setContrastError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const altInputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  useEffect(() => {
    let active = true;
    setImages([]);
    setImagesLoading(true);
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
      })
      .finally(() => {
        if (active) setImagesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [contentId]);

  useEffect(() => {
    setContrastForeground(foregroundColor ?? "#26323B");
    setContrastBackground(backgroundColor ?? "#FAF8F3");
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

  async function checkContrast() {
    if (!contrastForeground.trim() || !contrastBackground.trim()) {
      setContrastError("Enter both foreground and background colors.");
      return;
    }
    setCheckingContrast(true);
    setContrastError("");
    setContrastResult(null);
    try {
      const result = await api.checkColorContrast(
        contrastForeground.trim(),
        contrastBackground.trim(),
        contrastTextSize,
      );
      setContrastResult(result);
    } catch (cause) {
      setContrastError(
        cause instanceof Error
          ? cause.message
          : "The contrast check could not be completed.",
      );
    } finally {
      setCheckingContrast(false);
    }
  }

  return (
    <div className="accessibility-tools-grid">
      <section
        className="image-accessibility-panel"
        aria-labelledby="images-heading"
      >
        <div className="accessibility-card-heading">
          <span className="accessibility-icon" aria-hidden="true">
            ▧
          </span>
          <div>
            <h2 id="images-heading">Upload Image</h2>
            <p className="muted">
              Add an image to review its content and accessibility.
            </p>
          </div>
        </div>
        {canEdit && (
          <div className="image-upload-controls">
            <label
              className="button image-upload-button"
              htmlFor="content-image-upload"
            >
              {busy ? "Uploading..." : "Upload image"}
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
                  {busy ? "Uploading..." : "Confirm upload"}
                </button>
              </div>
            )}
          </div>
        )}
        {selectedPreview && (
          <div className="pending-image">
            <div className="image-preview image-preview-pending">
              <img src={selectedPreview} alt="Selected image preview" />
              <span>{selectedFile?.name} · not uploaded yet</span>
            </div>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setSelectedFile(null);
                setSelectedPreview("");
                setMessage("");
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            >
              Remove selected image
            </button>
          </div>
        )}
        {images.length > 0 && (
          <details
            className="uploaded-images"
            open={images.some((image) => !(altText[image.id] ?? "").trim())}
          >
            <summary>
              Uploaded images <span>({images.length})</span>
            </summary>
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
                          Missing alternative text for {image.filename}. Add
                          text to communicate relevant image information to
                          people using assistive technology.
                          <button
                            type="button"
                            className="text-button"
                            onClick={() =>
                              altInputRefs.current[image.id]?.focus()
                            }
                          >
                            Add alt text
                          </button>
                        </p>
                      )}
                      <label
                        className="form-field"
                        htmlFor={`alt-text-${image.id}`}
                      >
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
          </details>
        )}
        {imagesLoading && (
          <p className="muted" role="status">
            Loading images...
          </p>
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
      </section>
      <section className="contrast-controls" aria-labelledby="contrast-heading">
        <div className="accessibility-card-heading">
          <span className="accessibility-icon contrast-icon" aria-hidden="true">
            ◐
          </span>
          <div>
            <h2 id="contrast-heading">Color Contrast (WCAG AA)</h2>
            <p className="muted">
              Check text and background colors for accessibility.
            </p>
          </div>
        </div>
        {contrastError && (
          <p className="form-error" role="alert">
            {contrastError}
          </p>
        )}
        {contrastResult && (
          <p
            className={`contrast-result${contrastResult.passes ? " passes" : " fails"}`}
            role="status"
          >
            <strong>
              {contrastResult.contrast_ratio.toFixed(2)}:1{" "}
              {contrastResult.passes ? "Pass" : "Does not pass"}
            </strong>
            <span>
              {contrastResult.text_size} text requires{" "}
              {contrastResult.required_ratio.toFixed(1)}:1 for WCAG AA.
            </span>
          </p>
        )}
        <div className="contrast-actions">
          {canEdit && (
            <button
              type="button"
              className="button contrast-check-button"
              onClick={() => void checkContrast()}
              disabled={checkingContrast}
            >
              {checkingContrast ? "Checking..." : "Check contrast"}
            </button>
          )}
          <details
            className="contrast-settings"
            open={Boolean(foregroundColor || backgroundColor)}
          >
            <summary>
              <span className="visually-hidden">Contrast settings</span>
            </summary>
            <div className="contrast-control-grid">
              <label className="form-field">
                Foreground color
                <input
                  type="text"
                  value={contrastForeground}
                  onChange={(event) => {
                    setContrastForeground(event.target.value);
                    setContrastResult(null);
                  }}
                  placeholder="#26323B"
                  disabled={!canEdit}
                />
              </label>
              <label className="form-field">
                Background color
                <input
                  type="text"
                  value={contrastBackground}
                  onChange={(event) => {
                    setContrastBackground(event.target.value);
                    setContrastResult(null);
                  }}
                  placeholder="#FAF8F3"
                  disabled={!canEdit}
                />
              </label>
              <label className="form-field">
                Text size
                <select
                  value={contrastTextSize}
                  onChange={(event) => {
                    setContrastTextSize(
                      event.target.value as "normal" | "large",
                    );
                    setContrastResult(null);
                  }}
                  disabled={!canEdit}
                >
                  <option value="normal">Normal</option>
                  <option value="large">Large</option>
                </select>
              </label>
              {canEdit && (
                <button
                  type="button"
                  className="button button-subtle"
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
          </details>
        </div>
      </section>
    </div>
  );
}
