import { cookies } from "next/headers";
import { BACKDROP_COOKIE } from "@openbookings/images";
import { getBackdrop } from "@openbookings/images/server";
import { RememberBackdrop } from "@openbookings/images/react";
import { SearchClient } from "./_components/SearchClient";

export default async function SearchPage() {
  const { backdrop, persist } = await getBackdrop((await cookies()).get(BACKDROP_COOKIE)?.value);
  return (
    <>
      <SearchClient backdrop={backdrop} />
      {persist && backdrop ? <RememberBackdrop id={backdrop.id} /> : null}
    </>
  );
}
