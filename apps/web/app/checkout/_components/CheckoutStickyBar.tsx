'use client';

import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useCheckoutElements } from '@stripe/react-stripe-js/checkout';

export const PAY_BUTTON_ID = 'checkout-pay';
export const PAYMENT_COLUMN_ID = 'checkout-payment';

type Props = {
  payNow: string;
  atProperty: string | null;
  reassurance: { tone: 'free' | 'neutral'; text: string };
  targetId: string;
  hidden: boolean;
};

/** Phone-only bar: the amount, the cancellation line and a way to the payment card. */
export function CheckoutStickyBar({ payNow, atProperty, reassurance, targetId, hidden }: Props) {
  if (hidden) return null;
  const free = reassurance.tone === 'free';
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/15 bg-black/70 pb-[env(safe-area-inset-bottom)] text-white backdrop-blur-xl lg:hidden">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {payNow}{' '}
            <span className="font-normal text-white/70">
              now{atProperty ? ` · ${atProperty} at the property` : ''}
            </span>
          </p>
          <p className={`flex items-center gap-1.5 text-xs ${free ? 'font-medium text-green-400' : 'text-white/70'}`}>
            <ShieldCheck aria-hidden className={`size-3.5 shrink-0 ${free ? 'text-green-400' : ''}`} />
            <span className="truncate">{reassurance.text}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className="h-10 shrink-0 rounded-xl bg-[#a5b4f0] px-4 text-sm font-semibold text-neutral-900 outline-none hover:bg-[#93a4e8] focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          Continue to payment
        </button>
      </div>
    </div>
  );
}

/** True while at least half of the real Pay button is on screen. The button comes and goes, so it is re-found on DOM changes. */
function usePayButtonVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let current: Element | null = null;
    const io = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), {
      threshold: 0.5,
    });
    const sync = () => {
      const el = document.getElementById(PAY_BUTTON_ID);
      if (el === current) return;
      if (current) io.unobserve(current);
      current = el;
      if (el) io.observe(el);
      else setVisible(false);
    };
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      io.disconnect();
    };
  }, []);
  return visible;
}

/** Reads Stripe's own total, so it must sit inside the CheckoutElementsProvider. */
export function CheckoutPhoneBar({
  payAtPropertyLine,
  reassurance,
}: {
  payAtPropertyLine: string | null;
  reassurance: Props['reassurance'];
}) {
  const state = useCheckoutElements();
  const visible = usePayButtonVisible();
  if (state.type !== 'success') return null;
  const atProperty = payAtPropertyLine?.match(/€\s?[\d.,]+/)?.[0] ?? null;
  return (
    <CheckoutStickyBar
      payNow={state.checkout.total.total.amount}
      atProperty={atProperty}
      reassurance={reassurance}
      targetId={PAYMENT_COLUMN_ID}
      hidden={visible}
    />
  );
}
