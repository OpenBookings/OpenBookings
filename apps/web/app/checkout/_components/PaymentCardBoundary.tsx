'use client';

import { Component, type ReactNode } from 'react';
import * as Sentry from '@sentry/nextjs';
import { ELEMENT_LOAD_FAILED } from '../_lib/errors';
import { CheckoutNotice } from './CheckoutNotice';

/**
 * Catches errors Stripe.js *throws* rather than reports.
 *
 * `onLoadError` only covers an Element that failed to render. A bad option —
 * `options.fields is not an accepted parameter`, say — is raised synchronously
 * while the Element is being created, so it escapes as a render error and, left
 * alone, unmounts the whole checkout: the guest is left on a blank page with
 * the failure visible only in the console.
 *
 * A class component because error boundaries have no hook equivalent.
 */
export class PaymentCardBoundary extends Component<
  { children: ReactNode; onRestart: () => void },
  { crashed: boolean }
> {
  state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error: Error) {
    // Always our bug rather than the guest's, and invisible without this.
    Sentry.captureException(error, {
      level: 'fatal',
      tags: { area: 'checkout', stage: 'element-render' },
    });
  }

  render() {
    if (this.state.crashed) {
      return <CheckoutNotice copy={ELEMENT_LOAD_FAILED} onRetry={this.props.onRestart} />;
    }
    return this.props.children;
  }
}
