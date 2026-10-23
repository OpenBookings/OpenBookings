import Image from "next/image";
import { CookieSettingsButton } from "@/components/CookieSettingsButton";

const productLinks = ["Features", "Pricing", "Documentation", "Security"];
const companyLinks = ["About", "Blog", "Privacy", "Terms"];

export function Footer({ embedded = false }: { embedded?: boolean }) {
  return (
    <footer
      className={
        embedded
          ? "border-t border-white/7 px-6 pt-16 pb-12 sm:px-16"
          : "border-t border-white/5 bg-mk-bg-deep px-6 pt-16 pb-12 sm:px-16"
      }
    >
      <div className="mx-auto max-w-300">
        <div className="mb-12 flex flex-col gap-10 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-85">
            <div className="mb-4 flex items-center gap-[11px]">
              <Image src="https://cdn.openbookings.co/Public/OB-LIGHT-WORDMARK.png" alt="OpenBookings Business" width={200} height={40} preload />
            </div>
            <p className="text-[13px] leading-[1.7] text-white/28">
              Open-Source Core · EU Data Residency · No surprises.
            </p>
          </div>
          <div className="flex gap-16">
            <div>
              <div className="mb-4 text-[11px] font-medium tracking-widest text-white/28 uppercase">Product</div>
              <div className="flex flex-col gap-3">
                {productLinks.map((label) => (
                  <a key={label} href="#" className="text-[14px] text-white/48 hover:text-white/70 transition-colors">
                    {label}
                  </a>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-4 text-[11px] font-medium tracking-widest text-white/28 uppercase">Company</div>
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
          <span className="flex items-center gap-4 text-[12px] text-white/20">
            <CookieSettingsButton className="hover:text-white/50 transition-colors" />
            <span>Built in Europe.</span>
          </span>
        </div>
      </div>
    </footer>
  );
}
