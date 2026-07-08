const REPO = "OpenBookings/OpenBookings";
const REPO_URL = `https://github.com/${REPO}`;

type Commit = {
  sha: string;
  message: string;
  author: string;
  date: string;
};

async function getLatestCommits(): Promise<Commit[]> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/commits?per_page=3`, {
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    const data: unknown = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map((c) => ({
      sha: String(c.sha).slice(0, 7),
      message: String(c.commit.message).split("\n")[0],
      author: String(c.commit.author?.name ?? "unknown"),
      date: String(c.commit.author?.date ?? ""),
    }));
  } catch {
    return [];
  }
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

const clauses = [
  {
    term: "30 days' notice",
    detail: "Any change to the rate is announced a full month before it takes effect.",
  },
  {
    term: "Published here first",
    detail: "The new rate appears on this page before it applies to anyone.",
  },
  {
    term: "Never retroactive",
    detail: "Bookings already made keep the rate they were made under. Always.",
  },
];

export async function RateLock() {
  const commits = await getLatestCommits();

  return (
    <section id="rate-lock" className="border-t border-white/5 bg-[#05101e] px-6 py-24 sm:px-16 sm:py-[120px]">
      <div className="mx-auto max-w-[1100px]">
        <div className="grid gap-16 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-24">
          {/* The pledge */}
          <div>
            <div className="mb-[18px] text-[11px] font-medium tracking-[0.15em] text-[#00C8A8] uppercase">
              Rate Lock
            </div>
            <h2 className="mb-10 font-(family-name:--font-cormorant) text-[44px] leading-[1.04] font-bold tracking-[-1px] text-white sm:text-[62px] sm:tracking-[-1.5px]">
              A number you can
              <br />
              plan around.
            </h2>
            <p className="mb-12 max-w-[48ch] font-(family-name:--font-cormorant) text-[24px] leading-[1.45] font-normal text-white/75 sm:text-[27px]">
              Our commission is set at <span className="text-[#00C8A8]">4.5%</span>. Any change requires 30
              days&apos; notice, is published here before it takes effect, and never applies to bookings
              already made.
            </p>
            <div>
              {clauses.map((clause, i) => (
                <div
                  key={clause.term}
                  className={`flex flex-col gap-1 border-t border-white/6 py-5 sm:flex-row sm:items-baseline sm:gap-10 ${
                    i === clauses.length - 1 ? "border-b" : ""
                  }`}
                >
                  <span className="w-44 shrink-0 text-[14px] font-medium text-white">{clause.term}</span>
                  <span className="text-[14px] leading-[1.7] text-white/40">{clause.detail}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Proof, not promises — live commits */}
          <div className="lg:pt-24">
            <div className="rounded-2xl border border-white/8 bg-[#0a1526] p-7">
              <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#4ade80] opacity-50" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-[#4ade80]" />
                  </span>
                  <span className="text-[11px] font-medium tracking-[0.15em] text-white/40 uppercase">
                    Live from GitHub
                  </span>
                </div>
                <span className="text-[11px] text-white/25">{REPO.split("/")[1]}</span>
              </div>

              {commits.length > 0 ? (
                <div>
                  {commits.map((commit) => (
                    <div key={commit.sha} className="border-t border-white/6 py-4 first:border-t-0 first:pt-0 last:pb-0">
                      <p className="mb-1.5 truncate text-[13px] font-medium text-white/80">{commit.message}</p>
                      <p className="text-[11px] text-white/30">
                        <span className="font-mono text-white/40">{commit.sha}</span>
                        <span className="mx-2">·</span>
                        {commit.author}
                        <span className="mx-2">·</span>
                        {relativeTime(commit.date)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-2 text-[13px] leading-[1.7] text-white/40">
                  The full booking engine is developed in the open — every fee calculation, every ranking
                  decision, every change in public view.
                </p>
              )}

              <a
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 flex items-center justify-center gap-2.5 rounded-[10px] border border-white/10 bg-white/4 py-3 text-[13px] font-medium text-white/70 transition-colors hover:border-white/20 hover:text-white"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.26 5.66.41.36.78 1.06.78 2.14 0 1.54-.02 2.79-.02 3.17 0 .31.21.67.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
                </svg>
                Read the source
              </a>
            </div>
            <p className="mt-4 px-1 text-[11px] leading-[1.7] text-white/22">
              You don&apos;t have to trust the pledge — you can watch it being kept.
            </p>
          </div>
        </div>

        {/* Where your data lives — booking data vs payment data */}
        <div className="mt-20 border-t border-white/6 pt-14 sm:mt-24">
          <div className="mb-10 max-w-[52ch]">
            <div className="mb-3 text-[11px] font-medium tracking-[0.15em] text-white/28 uppercase">
              Where your data lives
            </div>
            <p className="text-[14px] leading-[1.75] text-white/40">
              Two kinds of data flow through a booking — and they deliberately never travel together.
            </p>
          </div>
          <div className="grid gap-y-10 sm:grid-cols-2 sm:gap-x-16">
            <div>
              <div className="mb-3 flex items-center gap-2.5">
                <span className="h-2 w-2 rounded-full bg-[#00C8A8]" />
                <span className="text-[15px] font-medium tracking-[-0.01em] text-white">Booking data — stays in the EU</span>
              </div>
              <p className="text-[14px] leading-[1.75] text-white/40">
                Reservations, guest names, messages, preferences — everything OpenBookings stores lives in
                EU-certified data centres and never leaves the European Economic Area. GDPR compliance is
                architectural, not a policy document.
              </p>
            </div>
            <div>
              <div className="mb-3 flex items-center gap-2.5">
                <span className="h-2 w-2 rounded-full bg-[#7B6AEE]" />
                <span className="text-[15px] font-medium tracking-[-0.01em] text-white">Payment data — never touches us</span>
              </div>
              <p className="text-[14px] leading-[1.75] text-white/40">
                Card details go directly from your guest to Stripe — PCI-DSS Level 1, the highest
                certification in payments — and settle straight to your account. Our servers never see a
                card number, so there&apos;s nothing to breach.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
