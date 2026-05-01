export const HOST_STEPS = [
  'core-info',
  'add-teams',
  'add-rooms',
  'define-pricing',
  'legal-n-boring',
  'stripe-connect',
] as const
  
  export type HostStep = typeof HOST_STEPS[number]