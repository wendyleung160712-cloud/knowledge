import { normalizeSpell } from './speech';

type TessWorker = {
  setParameters: (p: Record<string, string>) => Promise<void>;
  recognize: (image: HTMLCanvasElement | string) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<void>;
};

let workerPromise: Promise<TessWorker> | null = null;
let loadError: string | null = null;

async function getWorker(): Promise<TessWorker> {
  if (loadError) throw new Error(loadError);
  if (!workerPromise) {
    workerPromise = (async () => {
      try {
        const { createWorker } = await import('tesseract.js');
        const worker = (await createWorker('eng')) as unknown as TessWorker;
        await worker.setParameters({
          tessedit_char_whitelist:
            "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ '-.…?",
          tessedit_pageseg_mode: '7',
          preserve_interword_spaces: '1',
        });
        return worker;
      } catch (e) {
        loadError = e instanceof Error ? e.message : 'OCR 加载失败';
        workerPromise = null;
        throw e;
      }
    })();
  }
  return workerPromise;
}

/** Upscale + threshold dark ink on white for better OCR. */
export function preprocessForOcr(source: HTMLCanvasElement, scale = 2.5): HTMLCanvasElement {
  const w = Math.max(1, Math.round(source.width * scale));
  const h = Math.max(1, Math.round(source.height * scale));
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const gray = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < d.length; i += 4, p += 1) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    gray[p] = g < 200 ? 0 : 255;
  }
  const dil = new Uint8Array(gray);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      if (gray[i] === 0) continue;
      if (
        gray[i - 1] === 0 ||
        gray[i + 1] === 0 ||
        gray[i - w] === 0 ||
        gray[i + w] === 0
      ) {
        dil[i] = 0;
      }
    }
  }
  for (let i = 0, p = 0; i < d.length; i += 4, p += 1) {
    const v = dil[p];
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

export function cleanOcrText(raw: string): string {
  return normalizeSpell(
    raw
      .replace(/[\n\r\t]+/g, ' ')
      .replace(/[|！]/g, 'l')
      .replace(/[^a-zA-Z0-9\s'\-.…?!,]/g, '')
      .trim(),
  );
}

export async function recognizeHandwriting(canvas: HTMLCanvasElement): Promise<string> {
  const prepared = preprocessForOcr(canvas, 2.8);
  const worker = await getWorker();
  const { data } = await worker.recognize(prepared);
  return cleanOcrText(data.text || '');
}

export function ocrWarmup(): void {
  void getWorker().catch(() => {
    /* ignore; will retry on check */
  });
}
