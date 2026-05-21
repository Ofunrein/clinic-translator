import * as React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { GoogleSignInButton } from "./google-signin-button";

interface LoginPageProps {
  searchParams: Promise<{ error?: string; next?: string }>;
}

export default async function LoginPage(
  props: LoginPageProps,
): Promise<React.JSX.Element> {
  const { error, next } = await props.searchParams;
  const callbackUrl = next && next.startsWith("/") ? next : "/";
  const errorMessage = errorToMessage(error);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Clinic Translator</CardTitle>
        <CardDescription>Sign in with your clinic Google account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <GoogleSignInButton callbackUrl={callbackUrl} />
        {errorMessage ? (
          <p className="text-sm text-destructive" role="alert">
            {errorMessage}
          </p>
        ) : null}
      </CardContent>
      <CardFooter className="text-xs text-muted-foreground">
        Authorized clinic staff only. All access is audited.
      </CardFooter>
    </Card>
  );
}

function errorToMessage(error: string | undefined): string | null {
  if (!error) return null;
  switch (error) {
    case "not_allowlisted":
      return "That email isn't on the clinic allowlist. Contact your administrator.";
    case "OAuthSignin":
    case "OAuthCallback":
    case "OAuthAccountNotLinked":
      return "Google sign-in failed. Please try again.";
    case "AccessDenied":
      return "Access denied.";
    default:
      return "Sign-in failed. Please try again.";
  }
}
