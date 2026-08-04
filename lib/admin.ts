import { adminAuth } from "@/firebase/admin";
import { DecodedIdToken } from "firebase-admin/auth";

const rawAdminUids = process.env.ADMIN_UIDS ?? "";
export const ADMIN_UIDS = rawAdminUids
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

export function getBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) {
    return null;
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

export async function verifyAdminRequest(
  request: Request,
): Promise<DecodedIdToken> {
  const token = getBearerToken(request);
  if (!token) {
    throw new Error("Missing authorization token");
  }

  const decoded = await adminAuth.verifyIdToken(token);
  if (!ADMIN_UIDS.length || !ADMIN_UIDS.includes(decoded.uid)) {
    throw new Error("Unauthorized");
  }

  return decoded;
}

export function getFirebaseStorageUrl(
  bucketName: string,
  filePath: string,
): string {
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(
    bucketName,
  )}/o/${encodeURIComponent(filePath)}?alt=media`;
}

const POPCOUNT_TABLE = new Array(256).fill(0).map((_, i) => {
  let count = 0;
  let value = i;
  while (value > 0) {
    count += value & 1;
    value >>= 1;
  }
  return count;
});

export function hammingDistanceHex(a: string, b: string): number {
  const normalizedA = a.trim().toLowerCase().replace(/^0x/, "");
  const normalizedB = b.trim().toLowerCase().replace(/^0x/, "");
  if (normalizedA.length !== normalizedB.length) {
    throw new Error("Hash lengths must match for Hamming distance");
  }

  const aHex = normalizedA.padStart(normalizedB.length, "0");
  const bHex = normalizedB.padStart(normalizedA.length, "0");
  let distance = 0;

  for (let i = 0; i < aHex.length; i += 2) {
    const aByte = parseInt(aHex.slice(i, i + 2), 16);
    const bByte = parseInt(bHex.slice(i, i + 2), 16);
    distance += POPCOUNT_TABLE[aByte ^ bByte];
  }

  return distance;
}
