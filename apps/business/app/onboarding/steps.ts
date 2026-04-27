export const HOST_STEPS = [
  'core-info',
  'legal-n-boring',
  'stripe-connect',
  'create-organization',
  'add-rooms',
  'define-pricing',
] as const
  
  export type HostStep = typeof HOST_STEPS[number]