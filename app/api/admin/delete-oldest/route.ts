import { adminDb, adminStorage } from "@/firebase/admin";
import { verifyAdminRequest } from "@/lib/admin";

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

export async function POST(request: Request) {
  try {
    await verifyAdminRequest(request);

    const body = await request.json();
    const count = Number(body?.count ?? 0);
    if (!Number.isInteger(count) || count <= 0) {
      return new Response(
        JSON.stringify({ error: "Delete count must be a positive integer." }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const puzzleSnapshot = await adminDb
      .collection("puzzles")
      .orderBy("date", "asc")
      .limit(count)
      .get();

    if (puzzleSnapshot.empty) {
      return new Response(
        JSON.stringify({ message: "No puzzles available to delete." }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const bucket = adminStorage.bucket();
    const batch = adminDb.batch();
    let lastDeletedDate = "";

    await Promise.all(
      puzzleSnapshot.docs.map(async (doc) => {
        const puzzleId = doc.id;
        const date = String(doc.data().date ?? "");
        if (date) {
          lastDeletedDate = date;
        }

        await Promise.all(
          IMAGE_VARIANT_FILES.map((fileName) =>
            bucket
              .file(`puzzles/${puzzleId}/${fileName}`)
              .delete({ ignoreNotFound: true }),
          ),
        );

        batch.delete(doc.ref);
      }),
    );

    await batch.commit();

    return new Response(
      JSON.stringify({
        message: `Deleted ${puzzleSnapshot.size} oldest puzzles (up through ${lastDeletedDate}).`,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status =
      message === "Missing authorization token" || message === "Unauthorized"
        ? 401
        : 500;
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
}
