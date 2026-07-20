export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="mx-4 flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed py-24 text-center lg:mx-6">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="text-sm text-muted-foreground">Coming soon.</p>
    </div>
  );
}
