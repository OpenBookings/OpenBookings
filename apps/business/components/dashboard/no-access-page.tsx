import type { CurrentProperty } from "@openbookings/authz";
import type { NavKey } from "@openbookings/authz/nav-access";
import { noAccessProps } from "@/lib/page-access";
import { NoAccess } from "./no-access";

/** <NoAccess> for `navKey` at the current hotel, with the org's owners and general managers to ask. */
export async function NoAccessPage({ navKey, current }: { navKey: NavKey; current: CurrentProperty }) {
  return <NoAccess {...await noAccessProps(navKey, current)} />;
}
