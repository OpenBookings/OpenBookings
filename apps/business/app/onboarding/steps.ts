export const HOST_STEPS = [
  'core-info-text',
  'core-info-location',
  'legal-n-boring',
  'stripe-connect',
] as const

export type HostStep = typeof HOST_STEPS[number]

/** Steps that belong to the same logical group in the sidebar. */
export const STEP_GROUPS = [
  { label: 'Core Information', steps: ['core-info-text', 'core-info-location'] as const },
  { label: 'Legal-n-Boring', steps: ['legal-n-boring'] as const },
  { label: 'Stripe Connect',   steps: ['stripe-connect'] as const },
] as const

export const STEP_SUB_LABELS: Record<HostStep, string> = {
  'core-info-text':     'Property Details',
  'core-info-location': 'Location',
  'legal-n-boring':     'Legal-n-Boring',
  'stripe-connect':     'Stripe Connect',
}

export const STEP_TITLES: Record<HostStep, string> = {
  'core-info-text':     'Tell us about your property',
  'core-info-location': 'Where is your property located?',
  'legal-n-boring':     'Legal & agreements',
  'stripe-connect':     'Set up payments',
}

export const STEP_SUBTITLES: Record<HostStep, string> = {
  'core-info-text':     'This is what guests will see on OpenBookings.',
  'core-info-location': 'We use this to show your property on the map.',
  'legal-n-boring':     'We need a few details before you can start accepting bookings.',
  'stripe-connect':     'Connect your Stripe account to receive payouts.',
}