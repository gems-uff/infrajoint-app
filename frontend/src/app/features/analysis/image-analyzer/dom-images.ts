/**
 * Browser image helpers shared by the analyzer page and the sequence
 * pre-processing pipeline (File → HTMLImageElement → canvas/pixels).
 */

export function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Falha ao decodificar ${file.name}`));
    };
    img.src = url;
  });
}

export function imageToCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d')?.drawImage(img, 0, 0);
  return canvas;
}

/** Full-resolution pixels of an image, or null when the canvas is unavailable. */
export function imageToPixels(img: HTMLImageElement): ImageData | null {
  return (
    imageToCanvas(img).getContext('2d')?.getImageData(0, 0, img.naturalWidth, img.naturalHeight) ??
    null
  );
}

/** Small JPEG thumbnail (data URL) of an image, `width` px wide. */
export function imageToThumbnail(img: HTMLImageElement, width: number): string {
  const scale = width / img.naturalWidth;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.7);
}
