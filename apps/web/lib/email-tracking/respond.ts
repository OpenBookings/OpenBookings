import { NextResponse } from "next/server";
import { PIXEL_GIF, clickDestination, handleClick, handleOpen, trackingConfig } from "@openbookings/mailing/tracking";

/** Runs a task after the response is sent; the routes pass Next's `after`. */
export type Schedule = (task: () => Promise<void>) => void;

const NO_STORE = "no-store, no-cache, must-revalidate, private";

export function openResponse(token: string, userAgent: string | null, schedule: Schedule): Response {
  schedule(() => handleOpen(token, userAgent));
  return new Response(PIXEL_GIF as BodyInit, {
    headers: { "Content-Type": "image/gif", "Cache-Control": NO_STORE },
  });
}

export function clickResponse(token: string, userAgent: string | null, schedule: Schedule): Response {
  const { destination, payload } = clickDestination(token, trackingConfig());
  schedule(() => handleClick(payload, userAgent));
  return NextResponse.redirect(destination, { status: 302, headers: { "Cache-Control": NO_STORE } });
}
