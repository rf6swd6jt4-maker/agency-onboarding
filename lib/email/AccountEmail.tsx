export type AccountEmailTemplateProps = {
    preview: string
    heading: string
    body: string
    code?: string | null
    actionLabel?: string | null
    actionUrl?: string | null
    detail?: string | null
    expires?: string | null
    tone?: "grey" | "yellow" | "green" | "red"
}

const colors = { background: "#0a0a0a", card: "#171717", border: "#404040", text: "#f5f5f5", muted: "#a3a3a3" }
const accents = { grey: "#a3a3a3", yellow: "#fde68a", green: "#6ee7b7", red: "#fca5a5" }

export function AccountEmail({ preview, heading, body, code, actionLabel, actionUrl, detail, expires, tone = "green" }: AccountEmailTemplateProps) {
    const accent = accents[tone]
    return <html lang="en"><body style={{ margin: 0, backgroundColor: colors.background, color: colors.text, fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" }}>
        <div style={{ display: "none", maxHeight: 0, overflow: "hidden", opacity: 0 }}>{preview}</div>
        <table role="presentation" width="100%" cellPadding="0" cellSpacing="0" style={{ borderCollapse: "collapse", backgroundColor: colors.background }}><tbody><tr><td align="center" style={{ padding: "40px 20px" }}>
            <table role="presentation" width="100%" cellPadding="0" cellSpacing="0" style={{ maxWidth: 560, borderCollapse: "separate", border: `1px solid ${colors.border}`, borderRadius: 16, backgroundColor: colors.card }}><tbody><tr><td style={{ padding: 32 }}>
                <p style={{ margin: "0 0 24px", color: accent, fontSize: 13, fontWeight: 700, letterSpacing: "0.12em" }}><span style={{ display: "inline-block", width: 8, height: 8, marginRight: 10, backgroundColor: accent, transform: "rotate(45deg)" }} />BETELGEZE</p>
                <h1 style={{ margin: "0 0 16px", color: colors.text, fontSize: 28, lineHeight: "1.25", fontWeight: 650 }}>{heading}</h1>
                <p style={{ margin: 0, color: "#d4d4d4", fontSize: 16, lineHeight: "1.65" }}>{body}</p>
                {code ? <div style={{ margin: "26px 0 8px", border: `1px solid ${colors.border}`, borderRadius: 12, backgroundColor: colors.background, padding: 18, textAlign: "center" }}><p style={{ margin: 0, color: colors.text, fontSize: 30, fontWeight: 700, letterSpacing: "0.28em", lineHeight: "1.2" }}>{code}</p></div> : null}
                {actionUrl && actionLabel ? <div style={{ marginTop: 26 }}><a href={actionUrl} style={{ display: "inline-block", borderRadius: 10, backgroundColor: colors.text, color: colors.background, fontSize: 15, fontWeight: 700, padding: "13px 19px", textDecoration: "none" }}>{actionLabel}</a></div> : null}
                {expires ? <p style={{ margin: "22px 0 0", color: colors.muted, fontSize: 13, lineHeight: "1.6" }}>{expires}</p> : null}
                {actionUrl ? <p style={{ margin: "18px 0 0", color: "#737373", fontSize: 12, lineHeight: "1.6", wordBreak: "break-all" }}>If the button does not work, copy this address into your browser:<br />{actionUrl}</p> : null}
                <hr style={{ margin: "28px 0 22px", border: 0, borderTop: "1px solid #303030" }} />
                <p style={{ margin: 0, color: colors.muted, fontSize: 13, lineHeight: "1.6" }}>{detail ?? "If you did not request this, you can safely ignore this email. Never share a verification code with anyone."}</p>
            </td></tr></tbody></table>
            <p style={{ margin: "18px 0 0", color: "#737373", fontSize: 12, textAlign: "center" }}>Betelgeze · Account security · hello@betelgeze.com</p>
        </td></tr></tbody></table>
    </body></html>
}
