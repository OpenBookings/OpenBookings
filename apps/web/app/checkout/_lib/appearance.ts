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

/**
 * The embedded form accepts a theme and variables but not `rules` — its own
 * type is `Omit<Appearance, 'rules'>`. Per-selector overrides for `.Input`,
 * `.Tab` and `.Label` therefore have nowhere to go: Stripe owns the internal
 * layout now, and the variables below are the whole customisation surface.
 */
export function buildAppearance(): Omit<Appearance, 'rules'> {
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
  };
}
