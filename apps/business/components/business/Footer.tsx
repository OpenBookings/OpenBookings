import Image from "next/image";

const productLinks = ["Features", "Pricing", "Documentation", "Security"];
const companyLinks = ["About", "Blog", "Privacy", "Terms"];

export function Footer({ embedded = false }: { embedded?: boolean }) {
  return (
    <footer
      className={
        embedded
          ? "border-t border-white/7 px-6 pt-16 pb-12 sm:px-16"
          : "border-t border-white/5 bg-[#040404] px-6 pt-16 pb-12 sm:px-16"
      }
    >
      <div className="mx-auto max-w-[1200px]">
        <div className="mb-12 flex flex-col gap-10 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-[340px]">
            <div className="mb-4 flex items-center gap-[11px]">
              <Image src="/OB-LOGO-LIGHT.png" alt="OpenBookings Business" width={100} height={100} />
              <span className="text-[15px] font-medium tracking-[-0.02em] text-white">OpenBookings Business</span>
            </div>
            <p className="text-[13px] leading-[1.7] text-white/28">
              Open-Source Core · EU Data Residency · No surprises.
            </p>
          </div>
          <div className="flex gap-16">
            <div>
              <div className="mb-4 text-[11px] font-medium tracking-[0.1em] text-white/28 uppercase">Product</div>
              <div className="flex flex-col gap-3">
                {productLinks.map((label) => (
                  <a key={label} href="#" className="text-[14px] text-white/48 hover:text-white/70 transition-colors">
                    {label}
                  </a>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-4 text-[11px] font-medium tracking-[0.1em] text-white/28 uppercase">Company</div>
              <div className="flex flex-col gap-3">
                {companyLinks.map((label) => (
                  <a key={label} href="#" className="text-[14px] text-white/48 hover:text-white/70 transition-colors">
                    {label}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-white/5 pt-6">
          <span className="text-[12px] text-white/20">© {new Date().getFullYear()} OpenBookings. All rights reserved.</span>
          <span className="text-[12px] text-white/20">Built in Europe.</span>
        </div>
      </div>
    </footer>
  );
}
