import type { Appearance } from '@stripe/stripe-js';

/**
 * Builds Stripe's Appearance object from our own design tokens.
 *
 * The Payment Element renders in a cross-origin iframe, so the CSS custom
 * properties in globals.css never reach it. Reading them here and passing the
 * resolved values across keeps the embedded fields matching the rest of the
 * page without a second, hand-maintained copy of the palette.
 */

/**
 * Normalises any CSS colour to `#rrggbb`.
 *
 * Our tokens are authored in oklch, which Stripe's appearance parser does not
 * accept. Reading fillStyle back is not enough: browsers now serialise wide
 * gamut inputs as `lab(...)`, which Stripe rejects just the same. Painting a
 * single pixel and sampling it gives us sRGB channels we can format ourselves,
 * so the conversion tracks the tokens instead of freezing a snapshot.
 */
function toHex(color: string, fallback: string): string {
  if (!color) return fallback;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return fallback;
    // An unparseable value leaves fillStyle at whatever it was. Two different
    // sentinels tell a rejected assignment apart from a colour that happens to
    // match one of them.
    ctx.fillStyle = '#000000';
    ctx.fillStyle = color;
    const first = ctx.fillStyle;
    ctx.fillStyle = '#ffffff';
    ctx.fillStyle = color;
    if (first === '#000000' && ctx.fillStyle === '#ffffff') return fallback;

    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  } catch {
    return fallback;
  }
}

function token(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  return toHex(styles.getPropertyValue(name).trim(), fallback);
}

/**
 * The payment card floats on the host's photograph rather than on our page
 * background, so its palette is pinned light instead of derived from
 * `--background`: the guest's dark-mode preference must not repaint a card
 * that is sitting on a bright image. Radius, font and the danger colour still
 * come from our tokens, which is what keeps the card recognisably ours.
 */
const CARD_SURFACE = '#e8eaf0';
const CARD_TEXT = '#1a1a1f';
const CARD_TEXT_SECONDARY = '#5c5c66';
const CARD_BORDER = '#d2d5de';
const CARD_FOCUS = '#5b6ee8';

/**
 * The same values, for the one field we have to render ourselves.
 *
 * Stripe's Checkout Sessions integration has no Element that collects a phone
 * number, so ours is plain HTML sitting between two iframes. Sharing the
 * palette from here is what stops it looking like a field from another form.
 */
export const CARD_FIELD = {
  surface: CARD_SURFACE,
  text: CARD_TEXT,
  label: CARD_TEXT_SECONDARY,
  border: CARD_BORDER,
  focus: CARD_FOCUS,
} as const;

export function buildAppearance(): Appearance {
  const styles = getComputedStyle(document.documentElement);
  const bodyFont = getComputedStyle(document.body).fontFamily;

  return {
    theme: 'stripe',
    variables: {
      colorPrimary: '#5b6ee8',
      colorBackground: CARD_SURFACE,
      colorText: CARD_TEXT,
      colorDanger: token(styles, '--destructive', '#a13b32'),
      colorTextSecondary: CARD_TEXT_SECONDARY,
      borderRadius: styles.getPropertyValue('--radius').trim() || '0.5rem',
      fontFamily: bodyFont || 'system-ui, sans-serif',
      fontSizeBase: '14px',
      spacingUnit: '4px',
    },
    rules: {
      '.Input': {
        backgroundColor: CARD_SURFACE,
        border: `1px solid ${CARD_BORDER}`,
        boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
      },
      '.Input:focus': {
        border: '1px solid #5b6ee8',
        boxShadow: '0 0 0 3px rgba(91, 110, 232, 0.25)',
      },
      '.Label': {
        fontWeight: '500',
        color: CARD_TEXT_SECONDARY,
      },
      // The Payment Element sits on its own white panel inside the card, as in
      // the design, so its method tabs read as a distinct surface.
      '.Tab': {
        backgroundColor: '#f7f8fa',
        border: `1px solid ${CARD_BORDER}`,
      },
      '.Tab--selected': {
        backgroundColor: '#ffffff',
        border: '1px solid #5b6ee8',
      },
    },
  };
}
