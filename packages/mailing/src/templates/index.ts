export const templates: Record<string, string> = {
  "magic-link": `<!doctype html>
<html>
  <body>
    <div
      style='background-color:#1a1a1a;color:#03124A;font-family:Avenir, "Avenir Next LT Pro", Montserrat, Corbel, "URW Gothic", source-sans-pro, sans-serif;font-size:16px;font-weight:400;letter-spacing:0.15008px;line-height:1.5;margin:0;padding:32px 0;min-height:100%;width:100%'
    >
      <table
        align="center"
        width="100%"
        style="margin:0 auto;max-width:600px;background-color:#1a1a1a"
        role="presentation"
        cellspacing="0"
        cellpadding="0"
        border="0"
      >
        <tbody>
          <tr style="width:100%">
            <td>
              <div style="padding:24px 24px 0px 24px;text-align:center">
                <img
                  alt=""
                  src="https://cdn.openbookings.co/Openbookings-logo-v2.png"
                  height="128"
                  style="height:128px;outline:none;border:none;text-decoration:none;vertical-align:middle;display:inline-block;max-width:100%"
                />
              </div>
              <h1
                style="color:#F0EDE8;font-weight:bold;text-align:center;margin:0;font-size:32px;padding:0px 24px 0px 24px"
              >
                OpenBookings
              </h1>
              <h3
                style="color:#797979;font-weight:bold;text-align:center;margin:0;font-size:20px;padding:0px 24px 0px 24px"
              >
                Quick, Easy and Open-Source
              </h3>
              <div style="padding:16px 24px 16px 24px">
                <h2
                  style="color:#F0EDE8;font-weight:bold;text-align:center;margin:0;font-size:24px;padding:16px 24px 0px 24px"
                >
                  Here&#x27;s your magic link 🔗
                </h2>
                <div
                  style="color:#F0EDE8;font-size:18px;font-weight:normal;text-align:center;padding:0px 24px 0px 24px"
                >
                  Someone (hopefully you) asked to sign in to OpenBookings.
                </div>
                <div
                  style="color:#F0EDE8;font-size:18px;font-weight:normal;text-align:center;padding:0px 24px 0px 24px"
                >
                  Here you go:
                </div>
                <div style="text-align:center;padding:16px 24px 16px 24px">
                  <a
                    href="{{magicLinkUrl}}"
                    style="color:#000000;font-size:21px;font-weight:bold;background-color:#ffe4b8;border-radius:4px;display:inline-block;padding:16px 32px;text-decoration:none"
                    target="_blank"
                    ><span
                      ><!--[if mso
                        ]><i
                          style="letter-spacing: 32px;mso-font-width:-100%;mso-text-raise:48"
                          hidden
                          >&nbsp;</i
                        ><!
                      [endif]--></span
                    ><span>Welcome Back!</span
                    ><span
                      ><!--[if mso
                        ]><i
                          style="letter-spacing: 32px;mso-font-width:-100%"
                          hidden
                          >&nbsp;</i
                        ><!
                      [endif]--></span
                    ></a
                  >
                </div>
                <div
                  style="color:#F0EDE8;font-weight:normal;text-align:center;padding:0px 24px 0px 24px"
                >
                  That&#x27;s it. Seriously, just click it.
                </div>
                <div style="padding:16px 72px 16px 72px">
                  <hr
                    style="width:100%;border:none;border-top:1px solid #CCCCCC;margin:0"
                  />
                </div>
                <div
                  style="color:#F0EDE8;font-weight:normal;text-align:center;padding:16px 24px 0px 24px"
                >
                  If the button&#x27;s being weird, paste this into your
                  browser:
                </div>
                <div
                  style="color:#f4f4f4;font-weight:normal;text-align:center;padding:0px 24px 16px 24px"
                >
                  {{magicLinkUrl}}
                </div>
                <div
                  style="color:#F0EDE8;font-weight:normal;text-align:center;padding:16px 24px 0px 24px"
                >
                  Wasn&#x27;t you? Just ignore this.
                </div>
                <div
                  style="color:#F0EDE8;font-weight:normal;text-align:center;padding:0px 24px 16px 24px"
                >
                  The link expires in 15 minutes anyway.
                </div>
              </div>
              <div style="padding:16px 72px 16px 72px">
                <hr
                  style="width:100%;border:none;border-top:1px solid #CCCCCC;margin:0"
                />
              </div>
              <div
                style='color:#ffffff;font-size:12px;font-family:"Nimbus Mono PS", "Courier New", "Cutive Mono", monospace;font-weight:normal;text-align:center;padding:16px 24px 0px 24px'
              >
                Roy here, reading all replies!
              </div>
              <div
                style='color:#ffffff;font-size:12px;font-family:"Nimbus Mono PS", "Courier New", "Cutive Mono", monospace;font-weight:normal;text-align:center;padding:0px 24px 16px 24px'
              >
                Especially those sent at 2AM from a hotel lobby.
              </div>
              <div
                style='color:#ffffff;font-size:12px;font-family:"Nimbus Mono PS", "Courier New", "Cutive Mono", monospace;font-weight:normal;text-align:center;padding:0px 24px 16px 24px'
              >
                Legally, and Boring: OpenBookings BV, [address], the
                Netherlands.
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </body>
</html>`,
};
