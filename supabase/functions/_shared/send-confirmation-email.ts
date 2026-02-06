import { Resend } from "npm:resend@2.0.0";
import { encode as base64Encode } from "https://deno.land/std@0.190.0/encoding/base64.ts";

// Embedded logo as base64 - loaded once at module level
let logoBase64Cache: string | null = null;

async function getLogoBase64(): Promise<string | null> {
  if (logoBase64Cache) return logoBase64Cache;
  try {
    const appUrl = Deno.env.get("APP_URL") || "https://enroll.himplant.com";
    const logoUrl = `${appUrl.replace(/\/$/, "")}/himplant-logo.png`;
    const resp = await fetch(logoUrl);
    if (!resp.ok) {
      console.error(`Failed to fetch logo from ${logoUrl}: ${resp.status}`);
      return null;
    }
    const bytes = new Uint8Array(await resp.arrayBuffer());
    logoBase64Cache = base64Encode(bytes);
    return logoBase64Cache;
  } catch (err) {
    console.error("Failed to load logo:", err);
    return null;
  }
}

interface SendConfirmationEmailParams {
  patientName: string;
  patientEmail: string;
  amountCents: number;
  currency: string;
  paymentMethodType: string;
  paymentDate: string;
  pdfBytes: Uint8Array | null;
  enrollmentId: string;
}

export async function sendConfirmationEmail(params: SendConfirmationEmailParams): Promise<void> {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    console.error("RESEND_API_KEY not configured, skipping confirmation email");
    return;
  }

  const resend = new Resend(resendApiKey);

  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (params.currency || "usd").toUpperCase(),
  }).format(params.amountCents / 100);

  const paymentDateFormatted = new Date(params.paymentDate).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  });

  const paymentMethod = params.paymentMethodType === "ach" ? "ACH Bank Transfer" : "Credit Card";

  // Try to get logo as base64 for inline embedding
  const logoB64 = await getLogoBase64();
  const logoSrc = logoB64 ? `data:image/png;base64,${logoB64}` : "";
  const logoHtml = logoSrc
    ? `<img src="${logoSrc}" alt="Himplant®" width="180" style="display:block; margin:0 auto; max-width:180px; height:auto;" />`
    : `<p style="margin:0; font-size:24px; color:#1a1a2e; font-weight:700; letter-spacing:1px;">Himplant®</p>`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0; padding:0; background-color:#f8f9fa; font-family: Arial, Helvetica, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f8f9fa; padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <!-- Header with logo -->
          <tr>
            <td style="padding:32px 40px 24px; text-align:center; border-bottom:2px solid #f0f0f0;">
              ${logoHtml}
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px 40px;">
              <h1 style="margin:0 0 20px; font-size:22px; color:#1a1a2e; font-weight:600;">
                Enrollment Confirmed
              </h1>
              <p style="margin:0 0 16px; font-size:15px; color:#333; line-height:1.6;">
                Dear ${params.patientName},
              </p>
              <p style="margin:0 0 16px; font-size:15px; color:#333; line-height:1.6;">
                Thank you for completing your enrollment. Your payment has been successfully processed.
              </p>
              <!-- Details box -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f4f4f8; border-radius:8px; margin:24px 0;">
                <tr>
                  <td style="padding:20px 24px;">
                    <p style="margin:0 0 8px; font-size:13px; color:#666; text-transform:uppercase; letter-spacing:0.5px; font-weight:600;">Payment Details</p>
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="padding:6px 0; font-size:14px; color:#555;">Date</td>
                        <td style="padding:6px 0; font-size:14px; color:#1a1a2e; text-align:right; font-weight:500;">${paymentDateFormatted}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0; font-size:14px; color:#555;">Amount</td>
                        <td style="padding:6px 0; font-size:14px; color:#1a1a2e; text-align:right; font-weight:500;">${amount}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0; font-size:14px; color:#555;">Payment Method</td>
                        <td style="padding:6px 0; font-size:14px; color:#1a1a2e; text-align:right; font-weight:500;">${paymentMethod}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 16px; font-size:15px; color:#333; line-height:1.6;">
                Your male enhancement expert will be in touch shortly to set up your consultation.
              </p>
              <p style="margin:0 0 16px; font-size:15px; color:#333; line-height:1.6;">
                A copy of your signed agreement is attached to this email for your records.
              </p>
              <p style="margin:0 0 4px; font-size:15px; color:#333; line-height:1.6;">
                If you have any questions, please don't hesitate to reach out to us at
                <a href="mailto:contact@himplant.com" style="color:#4a6cf7; text-decoration:none;">contact@himplant.com</a>.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px; border-top:1px solid #eee; text-align:center;">
              <p style="margin:0 0 4px; font-size:13px; color:#999;">
                Warm regards,
              </p>
              <p style="margin:0; font-size:14px; color:#1a1a2e; font-weight:600;">
                The Himplant® Team
              </p>
              <p style="margin:16px 0 0; font-size:11px; color:#bbb;">
                &copy; ${new Date().getFullYear()} Himplant&reg;. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const attachments: Array<{ filename: string; content: string }> = [];
  if (params.pdfBytes) {
    let binary = "";
    for (let i = 0; i < params.pdfBytes.length; i++) {
      binary += String.fromCharCode(params.pdfBytes[i]);
    }
    const base64 = btoa(binary);
    attachments.push({
      filename: "Himplant-Enrollment-Agreement.pdf",
      content: base64,
    });
  }

  try {
    const result = await resend.emails.send({
      from: "Himplant® <noreply@himplant.com>",
      to: [params.patientEmail],
      cc: ["contact@himplant.com"],
      bcc: ["ray@himplant.com", "kyle@himplant.com", "justin@himplant.com"],
      reply_to: "contact@himplant.com",
      subject: "Your Himplant® Enrollment Confirmation",
      html,
      attachments,
    });
    console.log(`Confirmation email sent to ${params.patientEmail}:`, result);
  } catch (err) {
    console.error("Failed to send confirmation email:", err);
  }
}
