import { RATE_INCLUSIVE_NOTICE } from "../_lib/rates-confirmation";

/**
 * The pricing basis, stated wherever a host types a price. Guests are shown
 * the number entered here as the total, so the place to say "this includes
 * tax" is at the field, not in a help page.
 */
export function RateInclusiveNotice({ className }: { className?: string }) {
  return (
    <p className={`text-muted-foreground text-xs ${className ?? ""}`}>
      {RATE_INCLUSIVE_NOTICE}
    </p>
  );
}
