import { verifyAdminRequest } from "@/lib/admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const decoded = await verifyAdminRequest(request);
    return new Response(
      JSON.stringify({ authorized: true, uid: decoded.uid }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return new Response(JSON.stringify({ authorized: false, error: message }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
}
