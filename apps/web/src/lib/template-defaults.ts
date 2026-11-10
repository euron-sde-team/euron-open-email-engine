/** A minimal, table-free-of-branding starting point for a new template. */
export const BLANK_TEMPLATE_HTML = `<!doctype html>
<html>
  <body style="margin:0;background:#f4f1ec;font-family:Arial,Helvetica,sans-serif;color:#1c1a17">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" style="padding:32px 16px">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff">
            <tr>
              <td style="padding:32px">
                <h1 style="margin:0 0 16px;font-size:24px">Hi {{first_name | default: "there"}},</h1>
                <p style="margin:0 0 16px;line-height:1.6">Write your message here.</p>
                <p style="margin:0;line-height:1.6">The team</p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;border-top:1px solid #e6e1d9;font-size:12px;color:#6b655d">
                You are receiving this because you subscribed.
                <a href="{{unsubscribe_url}}" style="color:#6b655d">Unsubscribe</a>
                &middot;
                <a href="{{view_in_browser_url}}" style="color:#6b655d">View in browser</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;
