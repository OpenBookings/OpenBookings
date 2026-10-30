import { cookies } from "next/headers";
import { BACKDROP_COOKIE } from "@openbookings/images";
import { getBackdrop } from "@openbookings/images/server";
import { RememberBackdrop } from "@openbookings/images/react";
import { HomeClient } from "./_components/HomeClient";

export default async function Home() {
  const { backdrop, persist } = await getBackdrop((await cookies()).get(BACKDROP_COOKIE)?.value);
  return (
    <>
      <HomeClient backdrop={backdrop} />
      {persist && backdrop ? <RememberBackdrop id={backdrop.id} /> : null}
    </>
  );
}
