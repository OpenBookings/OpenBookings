'use client';

import {
  IconCircleCheckFilled,
  IconCircleDashed,
  IconChevronDown,
  IconChevronUp,
} from '@tabler/icons-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

export const ONBOARDING_STEPS = [
  {
    id: 'core-info',
    title: 'Property details',
    description: 'Add your property name, description, and photos.',
    completed: true,
    actionLabel: 'Edit details',
    actionHref: '#',
  },
  {
    id: 'location',
    title: 'Location',
    description: 'Confirm your address and map pin.',
    completed: true,
    actionLabel: 'Edit location',
    actionHref: '#',
  },
  {
    id: 'legal',
    title: 'Legal & agreements',
    description: 'Sign the partner and data processing agreements.',
    completed: true,
    actionLabel: 'Review',
    actionHref: '#',
  },
  {
    id: 'stripe',
    title: 'Payment setup',
    description: 'Connect Stripe to receive payouts from bookings.',
    completed: false,
    actionLabel: 'Connect Stripe',
    actionHref: '#',
  },
  {
    id: 'first-room',
    title: 'Add your first room',
    description: 'Create a room type with pricing and availability.',
    completed: false,
    actionLabel: 'Add room',
    actionHref: '#',
  },
  {
    id: 'go-live',
    title: 'Go live',
    description: 'Publish your property so guests can find and book it.',
    completed: false,
    actionLabel: 'Publish',
    actionHref: '#',
  },
];

function CircularProgress({ completed, total }: { completed: number; total: number }) {
  const offset = total > 0 ? 100 - (completed / total) * 100 : 100;
  return (
    <svg className="-rotate-90 shrink-0" height="12" viewBox="0 0 14 14" width="12">
      <circle className="stroke-border" cx="7" cy="7" fill="none" pathLength="100" r="6" strokeWidth="2.5" />
      <circle
        className="stroke-primary"
        cx="7" cy="7" fill="none"
        pathLength="100" r="6"
        strokeDasharray="100"
        strokeLinecap="round"
        strokeWidth="2.5"
        style={{ strokeDashoffset: offset }}
      />
    </svg>
  );
}

export function OnboardingChecklist() {
  const [steps, setSteps] = useState(ONBOARDING_STEPS);
  const [openId, setOpenId] = useState<string | null>(
    () => ONBOARDING_STEPS.find((s) => !s.completed)?.id ?? null
  );

  const completedCount = steps.filter((s) => s.completed).length;

  function handleAction(id: string) {
    const updated = steps.map((s) => (s.id === id ? { ...s, completed: true } : s));
    setSteps(updated);
    setOpenId(updated.find((s) => !s.completed)?.id ?? null);
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 px-1 pb-2 border-b border-border">
        <CircularProgress completed={completedCount} total={steps.length} />
        <span className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{completedCount}</span>
          {' '}of{' '}
          <span className="font-medium text-foreground">{steps.length}</span>
          {' '}completed
        </span>
      </div>

      <div className="space-y-0.5 pt-1">
        {steps.map((step) => {
          const isOpen = openId === step.id;
          return (
            <div key={step.id}>
              <button
                className={cn(
                  'w-full flex items-center gap-2.5 px-2 py-2 rounded-md text-left transition-colors',
                  isOpen ? 'bg-secondary' : 'hover:bg-secondary/60'
                )}
                onClick={() => setOpenId(isOpen ? null : step.id)}
              >
                {step.completed ? (
                  <IconCircleCheckFilled className="size-4 shrink-0 text-primary" />
                ) : (
                  <IconCircleDashed className="size-4 shrink-0 text-muted-foreground/40" strokeWidth={2} />
                )}
                <span className={cn(
                  'flex-1 text-sm',
                  step.completed ? 'text-muted-foreground line-through' : 'text-foreground'
                )}>
                  {step.title}
                </span>
                {!step.completed && (
                  isOpen
                    ? <IconChevronUp className="size-3.5 shrink-0 text-muted-foreground" />
                    : <IconChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                )}
              </button>

              {isOpen && !step.completed && (
                <div className="ml-9 mr-2 mt-0.5 mb-2">
                  <p className="text-xs text-muted-foreground leading-relaxed mb-2">
                    {step.description}
                  </p>
                  <a
                    href={step.actionHref}
                    onClick={(e) => { e.preventDefault(); handleAction(step.id); }}
                    className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                  >
                    {step.actionLabel} →
                  </a>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
