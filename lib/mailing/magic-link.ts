import { SendEmailCommand } from "@aws-sdk/client-sesv2"
import { ses } from "@/lib/mailing/ses"

export async function sendMagicLink(email: string, url: string, firstName?: string) {
  await ses.send(new SendEmailCommand({
    FromEmailAddress: "Roy at OpenBookings <noreply@openbookings.co>",
    Destination: {
      ToAddresses: [email]
    },
    Content: {
      Template: {
        TemplateName: "Magic-Link",
        TemplateData: JSON.
        stringify({
          magicLinkUrl: url
        })
      }
    }
  }))
}
