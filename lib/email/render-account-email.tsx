import "server-only"

import { render } from "@react-email/render"
import { AccountEmail, type AccountEmailTemplateProps } from "@/lib/email/AccountEmail"

export async function renderAccountEmail(props: AccountEmailTemplateProps) {
    const element = <AccountEmail {...props} />
    const [html, text] = await Promise.all([
        render(element),
        render(element, { plainText: true }),
    ])
    return { html, text }
}
