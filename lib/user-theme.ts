import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { staffUsers } from "@/lib/db/schema";
import { isThemePreference, type ThemePreference } from "@/lib/theme";

export async function getUserThemePreference(
  userId: string,
): Promise<ThemePreference | null> {
  const rows = await db
    .select({ themePreference: staffUsers.themePreference })
    .from(staffUsers)
    .where(eq(staffUsers.id, userId))
    .limit(1);
  const value = rows[0]?.themePreference;
  return isThemePreference(value) ? value : null;
}

export async function setUserThemePreference(
  userId: string,
  theme: ThemePreference,
): Promise<void> {
  await db
    .update(staffUsers)
    .set({ themePreference: theme })
    .where(eq(staffUsers.id, userId));
}
