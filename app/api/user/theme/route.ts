import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/api/auth";
import { errorToResponse, newTraceId } from "@/lib/api/errors";
import { getUserThemePreference, setUserThemePreference } from "@/lib/user-theme";
import { THEME_COOKIE, type ThemePreference } from "@/lib/theme";

export const runtime = "nodejs";

const patchSchema = z.object({
  theme: z.enum(["light", "dark"]),
});

export async function GET(req: Request): Promise<NextResponse> {
  const traceId = newTraceId();
  try {
    const { userId } = await requireUser(req);
    const theme = (await getUserThemePreference(userId)) ?? "light";
    return NextResponse.json({ theme, trace_id: traceId });
  } catch (err) {
    return errorToResponse(err);
  }
}

export async function PATCH(req: Request): Promise<NextResponse> {
  const traceId = newTraceId();
  try {
    const { userId } = await requireUser(req);
    const json: unknown = await req.json().catch(() => null);
    const parsed = patchSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { code: "validation", message: "theme must be light or dark", trace_id: traceId },
        { status: 400 },
      );
    }

    const theme: ThemePreference = parsed.data.theme;
    await setUserThemePreference(userId, theme);

    const res = NextResponse.json({ theme, trace_id: traceId });
    res.cookies.set(THEME_COOKIE, theme, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    return res;
  } catch (err) {
    return errorToResponse(err);
  }
}
