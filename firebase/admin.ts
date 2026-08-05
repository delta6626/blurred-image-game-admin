import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";

function normalizeEnv(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }

  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/\\n/g, "\n");
  }

  return trimmed;
}

const app =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp({
        credential: cert({
          projectId: normalizeEnv(process.env.FIREBASE_PROJECT_ID),
          clientEmail: normalizeEnv(process.env.FIREBASE_CLIENT_EMAIL),
          privateKey: normalizeEnv(process.env.FIREBASE_PRIVATE_KEY)?.replace(
            /\\n/g,
            "\n",
          ),
        }),
        storageBucket: normalizeEnv(process.env.FIREBASE_STORAGE_BUCKET),
      });

export const adminDb = getFirestore(app);
export const adminAuth = getAuth(app);
export const adminStorage = getStorage(app);
