/** Splits a spoken phrase into at most three short pieces that fit on the sky. */
export function phrasePieces(text: string, maxLength = 18): string[] {
  const pieces: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (current && (current + " " + word).length > maxLength) {
      pieces.push(current);
      current = word;
    } else current = current ? `${current} ${word}` : word;
  }
  if (current) pieces.push(current);
  return pieces.slice(0, 3);
}

/**
 * Turns a word into points: the text is drawn on a hidden canvas and every filled pixel
 * (in a grid) becomes one point. Result is centered, in world units.
 */
export function textToPoints(text: string, maxWidth = 14, height = 2.2): Float32Array {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const font = "700 140px 'Space Grotesk Variable', 'Segoe UI', sans-serif";
  ctx.font = font;
  const textWidth = Math.ceil(ctx.measureText(text).width) + 20;
  canvas.width = Math.min(2400, textWidth);
  canvas.height = 180;
  ctx.font = font;
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 10, 92);
  const { data, width, height: h } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const unit = Math.min(height / 140, maxWidth / width);
  const step = 4;
  const out: number[] = [];
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < width; x += step) {
      if (data[(y * width + x) * 4 + 3] > 128) out.push((x - width / 2) * unit, (h / 2 - y) * unit);
    }
  }
  return new Float32Array(out);
}
