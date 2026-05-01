"use client";

interface Props {
  visible: boolean;
}

export function AuthLoadingScreen({ visible }: Props) {
  return (
    <div
      aria-hidden={!visible}
      className="fixed inset-0 z-[200] bg-black flex items-center justify-center"
      style={{
        opacity: visible ? 1 : 0,
        visibility: visible ? "visible" : "hidden",
        transition: "opacity 0.5s ease, visibility 0.5s ease",
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      <img
        src="https://cdn.openbookings.co/Openbookings-logo-v2.png"
        alt="OpenBookings"
        draggable="false"
        className="h-16 sm:h-20 w-auto select-none pointer-events-none animate-pulse"
        style={{ userSelect: "none", WebkitUserSelect: "none" }}
      />
    </div>
  );
}
