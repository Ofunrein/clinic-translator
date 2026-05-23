import { redirect } from "next/navigation";

interface SignupPageProps {
  searchParams: Promise<{ next?: string }>;
}

export default async function SignupPage(props: SignupPageProps): Promise<never> {
  const { next } = await props.searchParams;
  const dest = next && next.startsWith("/") ? `/?signup=1&next=${encodeURIComponent(next)}` : "/?signup=1";
  redirect(dest);
}
