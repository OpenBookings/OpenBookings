"use client"

export default function DeadEndpointPage() {
  return (
    <div className="min-h-screen flex flex-col justify-center items-center bg-background text-foreground px-4">
      <div className="max-w-md w-full text-center">
        <h1 className="text-4xl font-bold mb-4">404: Dead Endpoint</h1>
        <p className="text-lg mb-6">
          This page is no longer active or does not exist.
        </p>
        <a
          href="/"
          className="inline-block px-6 py-3 bg-primary text-primary-foreground rounded-md font-medium shadow hover:bg-primary/90 transition"
        >
          Go Home
        </a>
      </div>
    </div>
  );
}