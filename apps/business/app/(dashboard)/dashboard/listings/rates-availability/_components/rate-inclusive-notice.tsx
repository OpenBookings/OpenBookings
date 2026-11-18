import { RATE_INCLUSIVE_NOTICE } from "../_lib/rates-confirmation";

/**
 * The pricing basis, stated wherever a host types a price. Guests pay the
 * number entered here plus tourist tax from the property's rules, so the
 * place to say "VAT in, tourist tax on top" is at the field, not in a help
 * page.
 */
export function RateInclusiveNotice({ className }: { className?: string }) {
  return (
    <p className={`text-muted-foreground text-xs ${className ?? ""}`}>
      {RATE_INCLUSIVE_NOTICE}
    </p>
  );
}
