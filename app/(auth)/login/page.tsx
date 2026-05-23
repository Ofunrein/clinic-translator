import { redirect } from "next/navigation";

interface LoginPageProps {
  searchParams: Promise<{ next?: string; error?: string }>;
}

export default async function LoginPage(props: LoginPageProps): Promise<never> {
  const { next } = await props.searchParams;
  const dest = next && next.startsWith("/") ? `/?next=${encodeURIComponent(next)}` : "/";
  redirect(dest);
}
