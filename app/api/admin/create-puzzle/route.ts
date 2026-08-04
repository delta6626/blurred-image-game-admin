import { adminDb, adminStorage } from "@/firebase/admin";
import {
  getFirebaseStorageUrl,
  hammingDistanceHex,
  verifyAdminRequest,
} from "@/lib/admin";
import {
  BLUR_STEPS,
  computePerceptualHash,
  createBlurVariant,
  createClearVariant,
} from "@/lib/image";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";

const IMAGE_VARIANT_FILES = [
  "step-1.jpg",
  "step-2.jpg",
  "step-3.jpg",
  "step-4.jpg",
  "step-5.jpg",
  "step-6.jpg",
  "clear.jpg",
];

function formatUtcDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseAcceptedAnswers(raw: string | null): string[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => String(item || "").trim())
        .filter((item) => item.length > 0);
    }
  } catch {
    // fallback to newline-separated values
  }

  return raw
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export async function POST(request: Request) {
  try {
    await verifyAdminRequest(request);

    const formData = await request.formData();
    const imageField = formData.get("image");
    const answer = String(formData.get("answer") ?? "").trim();
    const acceptedAnswers = parseAcceptedAnswers(
      String(formData.get("acceptedAnswers") ?? ""),
    );
    const category = String(formData.get("category") ?? "").trim();

    if (!imageField || !(imageField instanceof File)) {
      return new Response(JSON.stringify({ error: "Missing puzzle image." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!answer) {
      return new Response(JSON.stringify({ error: "Answer is required." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const fileBuffer = Buffer.from(await imageField.arrayBuffer());
    const phash = await computePerceptualHash(fileBuffer);

    const hashSnapshot = await adminDb.collection("usedImageHashes").get();
    for (const hashDoc of hashSnapshot.docs) {
      const data = hashDoc.data();
      if (!data.phash) {
        continue;
      }

      if (hammingDistanceHex(String(data.phash), phash) <= 7) {
        return new Response(
          JSON.stringify({
            error:
              "A visually similar image has already been used. Please choose a different photo.",
          }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
    }

    const latestDateSnapshot = await adminDb
      .collection("puzzles")
      .orderBy("date", "desc")
      .limit(1)
      .get();

    const assignedDate = latestDateSnapshot.empty
      ? formatUtcDate(new Date())
      : (() => {
          const latestDate = String(
            latestDateSnapshot.docs[0].data().date ?? "",
          );
          const [year, month, day] = latestDate.split("-").map(Number);
          const next = new Date(Date.UTC(year, month - 1, day));
          next.setUTCDate(next.getUTCDate() + 1);
          return formatUtcDate(next);
        })();

    const latestNumberSnapshot = await adminDb
      .collection("puzzles")
      .orderBy("puzzleNumber", "desc")
      .limit(1)
      .get();

    const puzzleNumber = latestNumberSnapshot.empty
      ? 1
      : Number(latestNumberSnapshot.docs[0].data().puzzleNumber ?? 0) + 1;

    const puzzleId = crypto.randomUUID();
    const bucket = adminStorage.bucket();

    const imageVariants: Record<string, string> = {};
    for (let index = 0; index < BLUR_STEPS.length; index += 1) {
      const fileName = IMAGE_VARIANT_FILES[index];
      const blurRadius = BLUR_STEPS[index];
      const variantBuffer = await createBlurVariant(fileBuffer, blurRadius);
      const filePath = `puzzles/${puzzleId}/${fileName}`;
      const file = bucket.file(filePath);
      await file.save(variantBuffer, {
        metadata: { contentType: "image/jpeg" },
        resumable: false,
      });
      imageVariants[`step${index + 1}`] = getFirebaseStorageUrl(
        bucket.name,
        filePath,
      );
    }

    const clearFilePath = `puzzles/${puzzleId}/clear.jpg`;
    const clearBuffer = await createClearVariant(fileBuffer);
    const clearFile = bucket.file(clearFilePath);
    await clearFile.save(clearBuffer, {
      metadata: { contentType: "image/jpeg" },
      resumable: false,
    });
    imageVariants.clear = getFirebaseStorageUrl(bucket.name, clearFilePath);

    const puzzleRef = adminDb.collection("puzzles").doc(puzzleId);
    const hashRef = adminDb.collection("usedImageHashes").doc();
    const batch = adminDb.batch();

    batch.set(puzzleRef, {
      date: assignedDate,
      puzzleNumber,
      imageVariants,
      answer,
      acceptedAnswers,
      category: category || null,
      phash,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: "admin", // The auth route verifies the user server-side and can later be extended to store decoded.uid
    });

    batch.set(hashRef, {
      phash,
      puzzleId: puzzleRef.path,
      dateUsed: assignedDate,
      createdAt: FieldValue.serverTimestamp(),
    });

    await batch.commit();

    return new Response(
      JSON.stringify({
        puzzleId,
        date: assignedDate,
        puzzleNumber,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
