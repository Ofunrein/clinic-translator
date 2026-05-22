import * as React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { SignupForm } from "./signup-form";

interface SignupPageProps {
  searchParams: Promise<{ next?: string }>;
}

export default async function SignupPage(
  props: SignupPageProps,
): Promise<React.JSX.Element> {
  const { next } = await props.searchParams;
  const callbackUrl = next && next.startsWith("/") ? next : "/app";

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Create account</CardTitle>
        <CardDescription>Sign up with your clinic email address.</CardDescription>
      </CardHeader>
      <CardContent>
        <SignupForm callbackUrl={callbackUrl} />
      </CardContent>
      <CardFooter className="text-xs text-muted-foreground">
        Authorized clinic staff only. All access is audited.
      </CardFooter>
    </Card>
  );
}
