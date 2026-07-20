import { SiteHeader } from "@/components/dashboard/site-header";

const TABS = [
  { label: "Rates & Availability", href: "/dashboard/listings/rates-availability" },
  { label: "Property", href: "/dashboard/listings/property" },
  { label: "Rooms", href: "/dashboard/listings/rooms" },
];

export default function ListingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader title="Listings" />
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">{children}</div>
        </div>
      </div>
    </>
  );
}
