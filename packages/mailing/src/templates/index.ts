export const templates: Record<string, string> = {
  "magic-link": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark" />
    <title>Sign in to OpenBookings</title>
    <style>
      @media only screen and (max-width: 600px) {
        .ob-wrapper { padding: 0 !important; }
        .ob-card { border-radius: 0 !important; }
        .ob-header { padding: 22px 20px !important; }
        .ob-body { padding: 40px 24px 36px !important; }
        .ob-footer { padding: 18px 24px 26px !important; }
        .ob-headline { font-size: 34px !important; line-height: 1.1 !important; }
        .ob-subtext { margin-bottom: 36px !important; }
        .ob-logo { max-width: 100px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background-color:#111111;">
    <table width="100%" cellspacing="0" cellpadding="0" border="0" role="presentation" style="background-color:#111111;">
      <tr>
        <td align="center" class="ob-wrapper" style="padding:40px 16px;">

          <!-- Card -->
          <table class="ob-card" width="100%" cellspacing="0" cellpadding="0" border="0" role="presentation" style="max-width:560px;background-color:#1A1A1A;border-radius:10px;border:1px solid rgba(255,255,255,0.08);">

            <!-- Header -->
            <tr>
              <td class="ob-header" align="center" style="padding:28px 40px 8px;">
                <img class="ob-logo" src="https://cdn.openbookings.co/Openbookings-logo-v2.png" alt="OpenBookings" style="display:block;max-width:116px;width:100%;height:auto;" />
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td class="ob-body" style="padding:32px 40px 48px;text-align:center;">

                <h1 class="ob-headline" style="font-family:Didot,'Big Caslon','Palatino Linotype',Palatino,'Book Antiqua',Georgia,serif;font-weight:400;font-size:40px;line-height:1.08;color:#F0F0F0;margin:0 0 16px;letter-spacing:-0.01em;">
                  Your magic key.
                </h1>

                <p class="ob-subtext" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif;font-size:15px;line-height:1.7;color:#888888;margin:0 auto 44px;max-width:320px;">
                  Works once and vanishes in 15&nbsp;minutes &mdash; no pressure, but maybe don't make tea first.
                </p>

                <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif;font-size:11px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:#555555;margin:0 0 8px;">
                  Signing in as
                </p>
                <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif;font-size:14px;color:#AAAAAA;margin:0 0 32px;letter-spacing:0.01em;">
                  {{email}}
                </p>

                <!-- CTA -->
                <table width="100%" cellspacing="0" cellpadding="0" border="0" role="presentation" style="margin-bottom:28px;">
                  <tr>
                    <td>
                      <a href="{{magicLinkUrl}}" target="_blank" style="display:block;background-color:#FFFFFF;color:#111111;text-align:center;padding:18px 32px;border-radius:7px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif;font-size:15px;font-weight:500;letter-spacing:0.02em;text-decoration:none;">Sign in &#x2192;</a>
                    </td>
                  </tr>
                </table>

                <!-- Fallback URL -->
                <table width="100%" cellspacing="0" cellpadding="0" border="0" role="presentation">
                  <tr>
                    <td style="background-color:#111111;border-radius:6px;padding:12px 14px;border:1px solid rgba(255,255,255,0.06);text-align:left;">
                      <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif;font-size:10px;font-weight:500;letter-spacing:0.08em;text-transform:uppercase;color:#555555;margin:0 0 6px;">Or copy this link</p>
                      <p style="font-family:'Courier New',Courier,monospace;font-size:11px;color:#777777;margin:0;word-break:break-all;line-height:1.75;">{{magicLinkUrl}}</p>
                    </td>
                  </tr>
                </table>

              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td class="ob-footer" style="padding:18px 40px 26px;text-align:center;">
                <p style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif;font-size:13px;color:#666666;line-height:1.65;margin:0;">
                  Not you? Ignore this, your account is untouched.
                </p>
              </td>
            </tr>

          </table>

          <!-- Below-card byline -->
          <table width="100%" cellspacing="0" cellpadding="0" border="0" role="presentation" style="max-width:560px;">
            <tr>
              <td style="padding:28px 40px 4px;text-align:center;font-family:'Nimbus Mono PS','Courier New',monospace;font-size:12px;line-height:1.6;color:#888888;">
                Got a question? Roy here, reads all replies.
              </td>
            </tr>
            <tr>
              <td style="padding:6px 40px 0;text-align:center;font-family:'Nimbus Mono PS','Courier New',monospace;font-size:11px;line-height:1.6;color:#444444;">
                Legally &amp; Boring: OpenBookings BV, [address], the Netherlands.
              </td>
            </tr>
          </table>
     

        </td>
      </tr>
    </table>
  </body>
</html>`,
};
