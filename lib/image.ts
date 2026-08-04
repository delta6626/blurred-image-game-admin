import sharp from "sharp";
import imghash from "imghash";

export const BLUR_STEPS = [24, 20, 18, 16, 12, 8] as const;

export async function computePerceptualHash(buffer: Buffer): Promise<string> {
  const hash = await imghash.hash(buffer, 8, "hex");
  return String(hash).toLowerCase();
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
