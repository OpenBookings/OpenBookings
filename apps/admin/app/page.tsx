import { requireSuperAdmin } from "@/lib/super-admin";

export default function Page() {
  requireSuperAdmin();
  return <p>Search comes in Task 4</p>;
}
