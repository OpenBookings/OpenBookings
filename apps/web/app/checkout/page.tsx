import { redirect } from 'next/navigation';

/** Checkout is always for one booking intent (`/checkout/<intentId>`); without one there is nothing to pay. */
export default function CheckoutIndexPage() {
  redirect('/');
}
