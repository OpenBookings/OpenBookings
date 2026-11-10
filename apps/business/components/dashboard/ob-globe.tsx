import { type CSSProperties, useId } from "react";
import { cn } from "@/lib/utils";

/**
 * The globe from the OpenBookings logo: eleven stripes traced from
 * `OB-LOGO-LIGHT.png`, in top-to-bottom order, in the logo's own gradient.
 * These are brand-mark colours, sampled from the logo, not UI tokens.
 */
const VIEW_BOX = "0 0 78.27 100.0";
const HEIGHT = 100.0;

const STRIPES = [
  "M60.4 6.6C56.1 5.4 53.2 3.5 53.2 1.9C53.2 1.0 53.0 1.0 56.7 2.1C60.2 3.1 60.1 3.0 59.4 3.4C58.1 4.1 59.1 5.2 62.1 6.4C62.8 6.7 63.4 6.9 63.4 6.9C63.7 7.2 61.7 6.9 60.4 6.6Z",
  "M63.8 14.4C49.7 13.2 37.3 5.5 42.0 0.9L42.6 0.4L45.8 0.5C47.6 0.6 49.0 0.7 49.1 0.7C49.1 0.8 48.9 1.1 48.5 1.4C44.4 5.0 52.0 11.3 63.9 14.0C65.0 14.2 66.0 14.5 66.1 14.5C66.1 14.6 66.1 14.6 63.8 14.4Z",
  "M63.5 24.0C44.2 21.5 27.2 12.0 30.0 5.3C30.8 3.6 31.3 3.2 34.7 2.3C38.3 1.3 38.2 1.3 37.1 2.5C31.1 9.1 45.2 19.4 66.0 23.6C67.4 23.9 68.7 24.2 68.8 24.2C69.3 24.4 65.6 24.2 63.5 24.0Z",
  "M68.4 35.6C45.0 34.1 20.3 22.8 19.7 13.4C19.4 10.4 20.9 8.4 25.2 6.2C27.3 5.1 27.8 5.0 27.0 5.8C25.5 7.2 24.7 10.4 25.3 12.6C28.0 21.7 47.1 31.6 68.6 35.0C73.7 35.8 73.6 36.0 68.4 35.6Z",
  "M69.7 47.9C46.8 47.0 19.0 36.2 12.8 25.6C9.8 20.7 11.0 16.8 16.7 12.2C18.1 11.1 18.1 11.1 17.1 12.5C16.8 12.9 16.5 13.7 16.3 14.2C11.6 26.7 40.6 44.2 71.8 47.5C76.1 47.9 75.3 48.1 69.7 47.9Z",
  "M65.4 60.1C42.2 58.4 15.8 48.0 7.9 37.5C4.2 32.6 4.2 28.5 7.7 23.1C8.8 21.4 9.0 21.4 8.6 22.9C4.7 38.0 39.2 57.6 73.5 59.7C76.0 59.9 76.9 60.0 76.4 60.0C75.7 60.2 67.0 60.2 65.4 60.1Z",
  "M63.2 71.7C36.2 69.6 7.8 57.2 3.0 45.6C1.6 42.2 1.6 36.8 3.1 33.3C3.2 32.8 3.3 33.0 3.3 34.7C3.3 42.6 11.7 51.4 26.4 58.9C40.8 66.2 57.4 70.5 74.3 71.3C76.5 71.4 77.0 71.4 76.4 71.5C75.7 71.7 64.7 71.9 63.2 71.7Z",
  "M61.5 81.9C43.8 81.1 24.7 75.1 11.8 66.4C2.9 60.3 0.8 56.9 0.6 48.0C0.5 45.7 0.5 44.5 0.7 44.5C0.8 44.5 0.9 45.2 0.9 46.1C1.6 58.1 24.1 72.9 50.5 78.8C57.9 80.4 63.1 81.0 70.8 81.2C76.3 81.3 76.4 81.3 74.8 81.5C71.4 82.0 66.7 82.2 61.5 81.9Z",
  "M56.1 90.1C55.8 90.1 54.7 90.0 53.5 89.9C39.8 88.5 25.3 83.8 14.7 77.2C7.3 72.6 3.8 68.7 1.9 62.8C1.1 60.7 0.3 56.1 0.7 56.4C0.8 56.4 0.9 56.8 1.0 57.2C1.4 60.2 4.5 64.9 8.3 68.5C22.6 82.1 50.9 91.2 72.7 89.2C74.7 89.1 73.9 89.3 71.4 89.7C69.1 90.1 58.0 90.4 56.1 90.1Z",
  "M51.3 96.0C42.3 95.1 32.6 92.4 22.6 87.8C14.4 84.0 8.2 78.5 5.9 73.1C4.9 70.7 5.0 70.6 6.3 72.6C13.0 82.7 32.7 92.4 51.2 94.8C56.7 95.5 64.4 95.6 68.1 95.1C68.5 95.0 68.8 95.0 68.7 95.0C68.6 95.2 65.3 95.7 62.4 96.0C59.0 96.3 54.8 96.3 51.3 96.0Z",
  "M48.5 99.3C34.8 97.9 21.0 92.0 15.0 85.0C13.4 83.1 13.4 82.8 15.0 84.3C23.0 91.8 36.4 97.3 49.9 98.5C52.9 98.8 60.3 98.7 62.4 98.3C63.9 98.0 64.4 98.0 63.4 98.3C59.9 99.4 53.7 99.8 48.5 99.3Z",
] as const;

const STOPS: ReadonlyArray<readonly [number, string]> = [
  [0.0047, "#ed705c"],
  [0.0873, "#ed875b"],
  [0.1698, "#eea15b"],
  [0.2524, "#f1ba5d"],
  [0.3349, "#f3d25f"],
  [0.4175, "#efe361"],
  [0.5, "#c8dc5f"],
  [0.5825, "#a3d45e"],
  [0.6651, "#82c387"],
  [0.7476, "#64b2c4"],
  [0.8302, "#5799de"],
  [0.9127, "#6d75ba"],
  [0.9953, "#8e5696"],
];

/**
 * `animated` gives each stripe the `ob-globe-stripe` class (globals.css): the
 * stripes catch the light one after another, top to bottom. Without it the
 * globe is the still logo.
 */
export function ObGlobe({ animated = false, className }: { animated?: boolean; className?: string }) {
  // useId can contain characters that break `url(#…)` in some browsers.
  const id = `ob-globe-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg viewBox={VIEW_BOX} className={cn("overflow-visible", className)} aria-hidden focusable="false">
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={HEIGHT}>
          {STOPS.map(([offset, color]) => (
            <stop key={offset} offset={offset} stopColor={color} />
          ))}
        </linearGradient>
      </defs>
      <g fill={`url(#${id})`}>
        {STRIPES.map((d, index) => (
          <path
            key={d}
            d={d}
            className={animated ? "ob-globe-stripe" : undefined}
            style={animated ? ({ "--i": index } as CSSProperties) : undefined}
          />
        ))}
      </g>
    </svg>
  );
}
