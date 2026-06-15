"use client";

import { useState } from "react";
import { Nav } from "@/components/nav";

export function NavWrapper() {
  const [authError, setAuthError] = useState<string | null>(null);
  return <Nav authError={authError} onDismissAuthError={() => setAuthError(null)} />;
}
