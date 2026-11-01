import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown, FileText, LifeBuoy, LockKeyhole, Mail, MessageSquare, CalendarDays } from "lucide-react";
import {
  EARLY_DEPARTURE_LINE,
  NO_SHOW_LINE,
  TIER_LABELS,
  TIER_SUMMARIES,
  TOURIST_TAX_LINE,
} from "@openbookings/pricing";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader, Row, RowList, Section } from "../_components/section";

export const metadata: Metadata = { title: "Help & Support" };

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "How do I change or cancel a booking?",
    a: (
      <>
        Open the booking from{" "}
        <Link href="/account/bookings" className="underline underline-offset-2 hover:text-foreground">
          Bookings
        </Link>
        . You can cancel the whole booking or a single room, and you see the exact refund before you confirm. To change
        dates, message the property.
      </>
    ),
  },
  {
    q: "What do Flex, Standard and Non-refundable mean?",
    a: (
      <ul className="flex flex-col gap-1.5">
        {(["flex", "standard", "non_refundable"] as const).map((tier) => (
          <li key={tier}>
            <span className="font-medium text-foreground">{TIER_LABELS[tier]}:</span> {TIER_SUMMARIES[tier]}
          </li>
        ))}
        <li>{EARLY_DEPARTURE_LINE}</li>
        <li>
          {TOURIST_TAX_LINE} {NO_SHOW_LINE}
        </li>
      </ul>
    ),
  },
  {
    q: "When does my refund arrive?",
    a: "Refunds go back to the card you paid with. It can take 5–10 days to show on your statement.",
  },
  {
    q: "Can I pay at the property?",
    a: "No. Every booking is paid in full on OpenBookings when you book, so there is nothing to pay at check-in.",
  },
  {
    q: "How do I reach the property before I arrive?",
    a: (
      <>
        Open the booking and choose Message the property. Replies show up in{" "}
        <Link href="/account/messages" className="underline underline-offset-2 hover:text-foreground">
          Messages
        </Link>
        .
      </>
    ),
  },
];

export default function HelpPage() {
  return (
    <>
      <PageHeader title="Help & Support" description="Answers to common questions, and how to reach us." />

      <Section id="help-faq" title="Common questions">
        <Card className="gap-0 divide-y overflow-hidden py-0">
          {FAQ.map((item) => (
            <details key={item.q} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-medium outline-none hover:bg-accent focus-visible:bg-accent [&::-webkit-details-marker]:hidden">
                {item.q}
                <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-5 pb-4 text-sm text-muted-foreground">{item.a}</div>
            </details>
          ))}
        </Card>
      </Section>

      <Section id="help-contact" title="Contact us" helper="Real people read every email.">
        <RowList>
          <ul className="divide-y">
            <Row
              icon={<LifeBuoy aria-hidden className="size-5" />}
              name="Bookings and payments"
              meta="support@openbookings.co"
              actions={
                <Button asChild variant="outline" className="h-11">
                  <a href="mailto:support@openbookings.co">
                    <Mail aria-hidden />
                    Email support
                  </a>
                </Button>
              }
            />
            <Row
              icon={<LockKeyhole aria-hidden className="size-5" />}
              name="Privacy and your data"
              meta="privacy@openbookings.co · we reply within 5 business days"
              actions={
                <Button asChild variant="outline" className="h-11">
                  <a href="mailto:privacy@openbookings.co">
                    <Mail aria-hidden />
                    Email privacy
                  </a>
                </Button>
              }
            />
            <Row
              icon={<MessageSquare aria-hidden className="size-5" />}
              name="A question about your stay"
              meta="The property knows its rooms, parking and check-in best."
              actions={
                <Button asChild variant="outline" className="h-11">
                  <Link href="/account/bookings">
                    <CalendarDays aria-hidden />
                    Open a booking
                  </Link>
                </Button>
              }
            />
          </ul>
        </RowList>
      </Section>

      <Section id="help-legal" title="Legal">
        <RowList>
          <ul className="divide-y">
            <Row
              icon={<FileText aria-hidden className="size-5" />}
              name={
                <Link href="/legal/en/terms" className="hover:underline">
                  Terms of service
                </Link>
              }
            />
            <Row
              icon={<FileText aria-hidden className="size-5" />}
              name={
                <Link href="/legal/en/privacy" className="hover:underline">
                  Privacy policy
                </Link>
              }
            />
          </ul>
        </RowList>
      </Section>
    </>
  );
}
