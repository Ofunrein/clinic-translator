import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api/auth";
import { UnauthorizedError, ForbiddenError, errorToResponse } from "@/lib/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  try {
    await requireUser(req);
  } catch (err) {
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return errorToResponse(err) as NextResponse;
    }
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const key = process.env.DEEPGRAM_API_KEY ?? "";
  if (!key) {
    return NextResponse.json({ error: "stt_not_configured" }, { status: 503 });
  }
  return NextResponse.json({ key }, { status: 200 });
}
