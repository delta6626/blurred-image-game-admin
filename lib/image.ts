import sharp from "sharp";

export const BLUR_STEPS = [24, 20, 18, 16, 12, 8] as const;

export async function computePerceptualHash(buffer: Buffer): Promise<string> {
  const raw = await sharp(buffer)
    .resize(8, 8, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer();

  const pixels = Array.from(raw.values());
  const average = pixels.reduce((sum, value) => sum + value, 0) / pixels.length;

  const hashChars = pixels
    .map((pixel) => (pixel >= average ? "1" : "0"))
    .join("");
  const hex =
    hashChars
      .match(/.{1,4}/g)
      ?.map((chunk) => parseInt(chunk, 2).toString(16))
      .join("") ?? "";

  return hex.padStart(16, "0");
}

export async function createBlurVariant(
  buffer: Buffer,
  radius: number,
): Promise<Buffer> {
  return sharp(buffer).blur(radius).jpeg({ quality: 80 }).toBuffer();
}

export async function createClearVariant(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer).jpeg({ quality: 80 }).toBuffer();
}
