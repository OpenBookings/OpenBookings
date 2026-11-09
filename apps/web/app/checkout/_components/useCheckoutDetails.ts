'use client';

import { useCallback, useEffect, useState } from 'react';
import { splitPhone } from '@/app/account/personal-details/_lib/phone';
import {
  parseCheckoutDetails,
  type CheckoutDetails,
  type DetailsField,
} from '@/app/account/personal-details/_lib/validate';
import { saveCheckoutDetails } from '../_lib/details-actions';
import { isCompleteForCheckout, prefillToFormData, type GuestDetailsPrefill } from '../_lib/guest-details';

/** Page order: the first field with an error gets focus. */
const FIELD_ORDER: DetailsField[] = ['name', 'phone', 'line1', 'line2', 'postalCode', 'city', 'country'];

export type CheckoutDetailsController = {
  mode: 'summary' | 'form';
  /** What the account holds now: the prefill, then whatever Pay last saved. */
  saved: GuestDetailsPrefill;
  errors: Partial<Record<DetailsField, string>>;
  /** Attach to the card's <form> as its `ref`. */
  bindForm: (form: HTMLFormElement | null) => void;
  /** Cancel is only offered when the saved details are enough to pay with. */
  canCancel: boolean;
  edit(): void;
  cancel(): void;
  /**
   * Synchronous, because a wallet button's click handler has one second to
   * answer. Opens the form on the first problem and returns null.
   */
  validate(): CheckoutDetails | null;
  /**
   * Validates, then saves to the account. When it didn't save, says why:
   * `invalid` (the card now shows the field errors) or `failed` (`saveError`
   * holds the sentence).
   */
  save(): Promise<SaveOutcome>;
  /** A save that failed for a reason no field can show. */
  saveError: string | null;
};

export type SaveOutcome =
  | { saved: true; details: CheckoutDetails }
  | { saved: false; reason: 'invalid' | 'failed' };

function toPrefill(details: CheckoutDetails, email: string): GuestDetailsPrefill {
  return {
    name: details.name,
    email,
    phone: splitPhone(details.phone, details.address.country),
    address: details.address,
  };
}

/**
 * The checkout's details card: shown as a summary when the account already has
 * everything checkout needs, as fields otherwise. The fields are uncontrolled
 * (like the account page), read from the form when Pay is pressed.
 */
export function useCheckoutDetails(prefill: GuestDetailsPrefill): CheckoutDetailsController {
  const [saved, setSaved] = useState(prefill);
  const [mode, setMode] = useState<'summary' | 'form'>(() => (isCompleteForCheckout(prefill) ? 'summary' : 'form'));
  const [errors, setErrors] = useState<Partial<Record<DetailsField, string>>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ field: DetailsField } | null>(null);
  // State, not a ref: the hook's functions read it, and React's rules keep
  // refs out of anything rendering touches.
  const [form, setForm] = useState<HTMLFormElement | null>(null);

  // After the form has rendered (it may only just have opened).
  useEffect(() => {
    if (focus) document.getElementById(focus.field)?.focus();
  }, [focus]);

  const currentData = useCallback(
    () => (mode === 'form' && form ? new FormData(form) : prefillToFormData(saved)),
    [mode, form, saved]
  );

  const fail = useCallback((fieldErrors: Partial<Record<DetailsField, string>>) => {
    setErrors(fieldErrors);
    setMode('form');
    const first = FIELD_ORDER.find((f) => fieldErrors[f]);
    if (first) setFocus({ field: first });
  }, []);

  const validate = useCallback((): CheckoutDetails | null => {
    setSaveError(null);
    const parsed = parseCheckoutDetails(currentData());
    if (!parsed.ok) {
      fail(parsed.errors);
      return null;
    }
    setErrors({});
    return parsed.value;
  }, [currentData, fail]);

  const save = useCallback(async (): Promise<SaveOutcome> => {
    if (!validate()) return { saved: false, reason: 'invalid' };
    const result = await saveCheckoutDetails(currentData());
    if (result.ok) {
      setSaved(toPrefill(result.details, saved.email));
      setMode('summary');
      return { saved: true, details: result.details };
    }
    if (result.errors && Object.keys(result.errors).length > 0) {
      fail(result.errors);
      return { saved: false, reason: 'invalid' };
    }
    setSaveError(result.message ?? null);
    return { saved: false, reason: 'failed' };
  }, [validate, currentData, fail, saved.email]);

  return {
    mode,
    saved,
    errors,
    bindForm: setForm,
    canCancel: isCompleteForCheckout(saved),
    edit: () => {
      setSaveError(null);
      setMode('form');
    },
    cancel: () => {
      setErrors({});
      setSaveError(null);
      setMode('summary');
    },
    validate,
    save,
    saveError,
  };
}
