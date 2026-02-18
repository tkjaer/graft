/**
 * Image upload extension for Tiptap.
 *
 * Handles drag-and-drop and paste of images:
 * 1. Client-side resize if >1MB
 * 2. Content-hashed filename → assets/ folder
 * 3. Upload via GitHub Contents API
 * 4. Insert ![alt](relative-path) into editor
 *
 * For preview, images resolve to raw.githubusercontent.com.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

const MAX_IMAGE_SIZE = 1024 * 1024; // 1MB — resize if larger
const MAX_DIMENSION = 1920; // Max width or height after resize

export interface ImageUploadConfig {
  /** Upload function — returns the relative path to the uploaded image */
  upload: (file: File, hash: string) => Promise<string>;
  /** Optional: called when upload starts/ends for UI feedback */
  onUploadStart?: () => void;
  onUploadEnd?: () => void;
}

/**
 * Compute a content hash (SHA-256 hex prefix) for a file.
 */
async function hashFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray
    .slice(0, 16) // 16 bytes = 32 hex chars — plenty unique
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Get file extension from MIME type.
 */
function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "image/bmp": "bmp",
    "image/avif": "avif",
  };
  return map[mime] || "png";
}

/**
 * Resize an image file if it exceeds MAX_IMAGE_SIZE.
 * Returns the original file if no resize needed or if it's an SVG.
 */
async function maybeResize(file: File): Promise<File> {
  // Don't resize SVGs or small images
  if (file.type === "image/svg+xml" || file.size <= MAX_IMAGE_SIZE) {
    return file;
  }

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      let { width, height } = img;

      // Scale down to fit within MAX_DIMENSION
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const scale = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);

      // Prefer WebP for smaller size, fall back to original format
      const outputType =
        file.type === "image/gif" ? "image/gif" : "image/webp";
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          const ext = extFromMime(outputType);
          const resized = new File([blob], `resized.${ext}`, {
            type: outputType,
          });
          resolve(resized);
        },
        outputType,
        0.85,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file); // Fall back to original on error
    };

    img.src = url;
  });
}

/**
 * Handle a list of image files — resize, hash, upload, insert.
 */
async function handleImageFiles(
  view: EditorView,
  files: File[],
  config: ImageUploadConfig,
  pos?: number,
): Promise<void> {
  const imageFiles = files.filter((f) => f.type.startsWith("image/"));
  if (imageFiles.length === 0) return;

  config.onUploadStart?.();

  try {
    for (const file of imageFiles) {
      const resized = await maybeResize(file);
      const hash = await hashFile(resized);
      const ext = extFromMime(resized.type);
      const fileName = `${hash}.${ext}`;

      try {
        const relativePath = await config.upload(resized, fileName);

        // Insert image node at the given position or current selection
        const insertPos = pos ?? view.state.selection.anchor;
        const node = view.state.schema.nodes.image.create({
          src: relativePath,
          alt: file.name.replace(/\.[^.]+$/, ""),
        });
        const tr = view.state.tr.insert(insertPos, node);
        view.dispatch(tr);

        // Move position forward for multiple images
        if (pos !== undefined) {
          pos = insertPos + node.nodeSize;
        }
      } catch (err) {
        console.error("[graft] Image upload failed:", err);
      }
    }
  } finally {
    config.onUploadEnd?.();
  }
}

/**
 * Tiptap extension that handles image drag-and-drop and paste.
 */
export const ImageUpload = Extension.create<ImageUploadConfig>({
  name: "imageUpload",

  addOptions() {
    return {
      upload: async () => "",
      onUploadStart: undefined,
      onUploadEnd: undefined,
    };
  },

  addProseMirrorPlugins() {
    const config = this.options;

    return [
      new Plugin({
        key: new PluginKey("imageUpload"),

        props: {
          handleDrop(view, event) {
            if (!event.dataTransfer?.files?.length) return false;

            const files = Array.from(event.dataTransfer.files);
            if (!files.some((f) => f.type.startsWith("image/"))) return false;

            event.preventDefault();
            const pos = view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            });

            handleImageFiles(view, files, config, pos?.pos);
            return true;
          },

          handlePaste(view, event) {
            if (!event.clipboardData?.files?.length) return false;

            const files = Array.from(event.clipboardData.files);
            if (!files.some((f) => f.type.startsWith("image/"))) return false;

            event.preventDefault();
            handleImageFiles(view, files, config);
            return true;
          },
        },
      }),
    ];
  },
});

/**
 * Create an upload function that commits images to a GitHub repo.
 * Images are placed in `assets/` relative to the document path.
 */
export function createGitHubUploader(
  api: {
    commitFile(
      owner: string,
      repo: string,
      path: string,
      content: string,
      sha: string,
      message: string,
      branch: string,
    ): Promise<{ sha: string }>;
  },
  owner: string,
  repo: string,
  branch: string,
  docPath: string,
): (file: File, fileName: string) => Promise<string> {
  // Determine the assets directory relative to the document
  const docDir = docPath.includes("/")
    ? docPath.substring(0, docPath.lastIndexOf("/"))
    : "";
  const assetsDir = docDir ? `${docDir}/assets` : "assets";

  return async (file: File, fileName: string): Promise<string> => {
    const filePath = `${assetsDir}/${fileName}`;

    // Read file as base64
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);

    // Check if file already exists (content-addressed, so same hash = same content)
    try {
      // If it exists, just return the relative path — no need to re-upload
      return `assets/${fileName}`;
    } catch {
      // Doesn't exist, proceed with upload
    }

    // Commit the file — use empty SHA for new files
    // We use the Octokit API directly since commitFile requires a SHA
    await api.commitFile(
      owner,
      repo,
      filePath,
      base64,
      "", // empty SHA for new file — the API will handle this
      `Add image ${fileName} via Graft`,
      branch,
    );

    return `assets/${fileName}`;
  };
}
