// NextAuth v5 catch-all route. All OAuth + session traffic flows through here.
import { handlers } from "@/lib/auth/config";

export const { GET, POST } = handlers;
