export default function SessionsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] overflow-x-hidden bg-white dark:bg-zinc-950">
      <div className="mx-auto max-w-5xl px-3 py-4 sm:px-4 sm:py-8">{children}</div>
    </div>
  );
}
