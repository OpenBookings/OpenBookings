import type { ReactNode } from "react";

type AnswerPart = string | { text: string; href: string };

const faqs: { question: string; answer: AnswerPart[] }[] = [
  {
    question: "Is the 4.5% on top of Stripe's fees?",
    answer: [
      "Yes. ", { text: "Stripe's payment processing", href: "https://stripe.com/en-nl/pricing"}, " is passed through at cost, we add no markup to it. Your total platform cost is typically around 6% of booking revenue, and you can see both lines separately on every payout.",
    ],
  },
  {
    question: "How can it be so much cheaper than Booking.com or Expedia?",
    answer: [
      "Because the rate is cost-based, not demand-based. 4.5% covers servers, support, payment infrastructure, and development. The large platforms charge 15–20% partly to fund advertising, including bidding on your own hotel's name. We don't do that, so we don't need to charge for it.",
    ],
  },
  {
    question: "What stops you from raising the rate later?",
    answer: [
      "The rate lock: any change requires 30 days' notice, are sent to your inbox/notification center, and never applies to bookings already made. And because the platform is open source and your data is exportable, leaving is easy. Which is the strongest incentive we have to stay honest.",
    ],
  },
  {
    question: "Do payouts go through OpenBookings?",
    answer: [
      "Partially. Between the guest payment and the payout sits a concept called ", { text: "Stripe Connect.", href: "https://stripe.com/en-nl/connect"}, " Payouts then follow the reconcilliation period for 7 calendar days (see 'platform agreement' for more info).",
    ],
  },
  {
    question: "What exactly is open source?",
    answer: [
      "The core booking engine and data models, including the fee and ranking logic, are public on GitHub under the MPL-2.0 license. Parameters like ranking points are kept in the so called 'black-box' to keep the platform fair to everyone.",
    ],
  },
  {
    question: "Where is guest data stored?",
    answer: [
      "Booking data (e.g. reservations, guest names, messages) is stored in EU-certified data centres and never leaves the European Economic Area. Payment data is different by design: card details go directly from the guest to Stripe (PCI-DSS Level 1) and never touch our servers at all.",
    ],
  },
  {
    question: "Am I locked in?",
    answer: [
      "No fixed term, we see this as an ongoing partnership rather than a set-term contract. Should your circumstances change, simply provide 30 days' notice so any existing bookings can be honoured smoothly. Your property and business data remain yours and can be exported at any time, while guest data cannot be bulk exported in line with GDPR requirements and the Partner Agreement.",
    ],
  },
];

function renderAnswer(answer: AnswerPart[]): ReactNode {
  return answer.map((part, i) =>
    typeof part === "string" ? (
      <span key={i}>{part}</span>
    ) : (
      <a
        key={i}
        href={part.href}
        className="text-white/70 underline underline-offset-2 hover:text-white"
        target={part.href.startsWith("http") ? "_blank" : undefined}
        rel={part.href.startsWith("http") ? "noopener noreferrer" : undefined}
      >
        {part.text}
      </a>
    ),
  );
}

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
            <div className="max-w-[620px] pb-7 text-[15px] leading-[1.8] text-white/42">
              {renderAnswer(faq.answer)}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
