import { getPostmarkClient } from "@openbookings/mailing"

const DEFAULT_FROM = "Roy at OpenBookings <noreply@openbookings.co>"
const FROM_ADDRESS =
  process.env.EMAIL_FROM_ADDRESS ?? process.env.MAGIC_LINK_FROM ?? DEFAULT_FROM

export async function sendMagicLink(email: string, url: string, _firstName?: string) {
  const postmarkClient = getPostmarkClient()

  await postmarkClient.sendEmailWithTemplate({
    From: FROM_ADDRESS,
    To: email,
    TemplateAlias: "code-your-own",
    TemplateModel: {
      magicLinkUrl: url,
    },
  })
}
