import { AppNav } from "@/components/AppNav";

export default function SessionsLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="min-h-[100dvh] overflow-x-hidden bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <span className="text-sm font-semibold tracking-tight">Clinic Translator</span>
          <AppNav />
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-3 py-4 sm:px-4 sm:py-8">{children}</div>
    </div>
  );
}
