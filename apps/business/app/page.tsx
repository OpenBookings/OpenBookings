import { Nav } from "@/components/business/Nav";
import { Hero } from "@/components/business/Hero";
import { Mechanism } from "@/components/business/Mechanism";
import { CostCalculator } from "@/components/business/CostCalculator";
import { RateLock } from "@/components/business/RateLock";
import { FoundersNote } from "@/components/business/FoundersNote";
import { FAQ } from "@/components/business/FAQ";
import { FinalCTA } from "@/components/business/FinalCTA";

export default function MarketingPage() {
  return (
    <div className="min-h-screen bg-[#080808] font-(family-name:--font-dm-sans) text-white">
      <Nav />
      <Hero />
      <Mechanism />
      <CostCalculator />
      <RateLock />
      <FoundersNote />
      <FAQ />
      <FinalCTA />
    </div>
  );
}
