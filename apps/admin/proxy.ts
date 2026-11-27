import { NextResponse, type NextRequest } from "next/server";
import { decide } from "@/lib/access";

export async function proxy(request: NextRequest) {
  const decision = await decide(request.headers, process.env);
  if (decision.kind === "deny") {
    return new NextResponse(decision.body, { status: decision.status });
  }
  return NextResponse.next({ request: { headers: decision.headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
