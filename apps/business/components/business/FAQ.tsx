const faqs = [
  {
    question: "Is the 4.5% on top of Stripe's fees?",
    answer:
      "Yes. Stripe's payment processing (1.5% + €0.25 per transaction for standard EEA cards) is passed through at cost — we add no markup to it. Your total platform cost is typically around 6% of booking revenue, and you can see both lines separately on every payout.",
  },
  {
    question: "How can it be so much cheaper than Booking.com or Expedia?",
    answer:
      "Because the rate is cost-based, not demand-based. 4.5% covers servers, support, payment infrastructure, and development. The large platforms charge 15–20% partly to fund advertising — including bidding on your own hotel's name. We don't do that, so we don't need to charge for it.",
  },
  {
    question: "What stops you from raising the rate later?",
    answer:
      "The rate lock: any change requires 30 days' notice, is published on this page before it takes effect, and never applies to bookings already made. And because the platform is open source and your data is exportable, leaving is easy — which is the strongest incentive we have to stay honest.",
  },
  {
    question: "Do payouts go through OpenBookings?",
    answer:
      "No. Payments run through your own Stripe account and settle directly to your bank. We never hold your money — the commission is collected per transaction, transparently, at the moment of booking.",
  },
  {
    question: "What exactly is open source?",
    answer:
      "The core booking engine and data models, including the fee and ranking logic, are public on GitHub under the MPL-2.0 license. You don't have to take our claims on faith — you can audit them.",
  },
  {
    question: "Where is guest data stored?",
    answer:
      "Booking data — reservations, guest names, messages — is stored in EU-certified data centres and never leaves the European Economic Area. Payment data is different by design: card details go directly from the guest to Stripe (PCI-DSS Level 1) and never touch our servers at all.",
  },
  {
    question: "Am I locked in?",
    answer:
      "No. There's no long-term contract and no exit fee. You own your data and can export it at any time. If we stop deserving your bookings, you can leave with everything.",
  },
];

export function FAQ() {
  return (
    <section id="faq" className="border-t border-white/5 bg-[#080808] px-6 py-24 sm:px-16 sm:py-[120px]">
      <div className="mx-auto max-w-[760px]">
        <div className="mb-[18px] text-[11px] font-medium tracking-[0.15em] text-white/28 uppercase">
          Common Questions
        </div>
        <h2 className="mb-15 font-(family-name:--font-cormorant) text-[40px] leading-[1.04] font-bold tracking-[-1px] text-white sm:text-[62px] sm:tracking-[-1.5px]">
          Answers to the
          <br />
          questions that matter.
        </h2>
        {faqs.map((faq, i) => (
          <details
            key={faq.question}
            className={`group border-t border-white/7 ${i === faqs.length - 1 ? "border-b" : ""}`}
          >
            <summary className="flex list-none items-center justify-between py-6 text-[17px] font-medium tracking-[-0.01em] text-white [&::-webkit-details-marker]:hidden cursor-pointer">
              <span>{faq.question}</span>
              <span className="ml-5 shrink-0 text-[22px] font-light text-white/28 group-open:hidden">+</span>
              <span className="ml-5 hidden shrink-0 text-[22px] font-light text-white/28 group-open:inline">−</span>
            </summary>
            <div className="max-w-[620px] pb-7 text-[15px] leading-[1.8] text-white/42">{faq.answer}</div>
          </details>
        ))}
      </div>
    </section>
  );
}
