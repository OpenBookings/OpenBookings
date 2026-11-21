import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

export function ComingSoon({ title }: { title: string }) {
  return (
    <Empty className="mx-4 rounded-xl border py-24 lg:mx-6">
      <EmptyHeader>
        <EmptyTitle className="text-sm">{title}</EmptyTitle>
        <EmptyDescription>Coming soon.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
