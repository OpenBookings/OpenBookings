import { NextResponse, type NextRequest } from "next/server";
import { isSuperAdminEnabled } from "@/lib/super-admin";

export async function proxy(request: NextRequest) {
  void request;
  if (!isSuperAdminEnabled()) {
    return new NextResponse("Not found", { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
