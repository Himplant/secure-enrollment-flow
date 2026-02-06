import { PDFDocument, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "  • ")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function wrapText(text: string, maxWidth: number, font: any, fontSize: number): string[] {
  const lines: string[] = [];
  const paragraphs = text.split("\n");

  for (const paragraph of paragraphs) {
    if (paragraph.trim() === "") {
      lines.push("");
      continue;
    }
    const words = paragraph.split(" ");
    let currentLine = "";
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const width = font.widthOfTextAtSize(testLine, fontSize);
      if (width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);
  }
  return lines;
}

export async function generateConsentPdf(
  enrollment: any,
  termsText: string | null,
  privacyText: string | null,
  signaturePngBytes: Uint8Array | null,
  clientIp: string,
  userAgent: string,
  paymentDate: string,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontSize = 10;
  const headerSize = 14;
  const margin = 50;
  const pageWidth = 612;
  const pageHeight = 792;
  const contentWidth = pageWidth - margin * 2;
  const lineHeight = fontSize * 1.4;

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const drawText = (text: string, options: { font?: any; size?: number; color?: any } = {}) => {
    const f = options.font || font;
    const s = options.size || fontSize;
    const c = options.color || rgb(0, 0, 0);
    if (y < margin + 40) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    page.drawText(text, { x: margin, y, font: f, size: s, color: c });
    y -= s * 1.4;
  };

  const drawWrappedText = (text: string) => {
    const lines = wrapText(text, contentWidth, font, fontSize);
    for (const line of lines) {
      if (y < margin + 20) {
        page = pdfDoc.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
      }
      if (line === "") {
        y -= lineHeight * 0.5;
      } else {
        page.drawText(line, { x: margin, y, font, size: fontSize, color: rgb(0, 0, 0) });
        y -= lineHeight;
      }
    }
  };

  // Header
  drawText("CONSENT & PAYMENT AUTHORIZATION", { font: fontBold, size: headerSize });
  y -= 10;

  // Patient details
  drawText("Patient Details", { font: fontBold, size: 12 });
  drawText(`Name: ${enrollment.patient_name || "N/A"}`);
  drawText(`Email: ${enrollment.patient_email || "N/A"}`);
  drawText(`Phone: ${enrollment.patient_phone || "N/A"}`);
  y -= 10;

  // Transaction details
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (enrollment.currency || "usd").toUpperCase(),
  }).format(enrollment.amount_cents / 100);
  drawText("Transaction Details", { font: fontBold, size: 12 });
  drawText(`Amount: ${amount}`);
  drawText(`Enrollment ID: ${enrollment.id}`);
  drawText(`Payment Date: ${new Date(paymentDate).toLocaleString("en-US", { timeZone: "America/New_York" })}`);
  drawText(`Terms Version: ${enrollment.terms_version}`);
  drawText(`Terms SHA-256: ${enrollment.terms_sha256}`);
  y -= 10;

  // Terms content
  if (termsText) {
    drawText("Terms of Service", { font: fontBold, size: 12 });
    y -= 4;
    const plainTerms = stripHtml(termsText);
    drawWrappedText(plainTerms);
    y -= 10;
  }

  if (privacyText) {
    drawText("Privacy Policy", { font: fontBold, size: 12 });
    y -= 4;
    const plainPrivacy = stripHtml(privacyText);
    drawWrappedText(plainPrivacy);
    y -= 10;
  }

  // Consent record
  drawText("Consent Record", { font: fontBold, size: 12 });
  drawText(`Terms Accepted At: ${enrollment.terms_accepted_at || "N/A"}`);
  drawText(`Payment Confirmed At: ${paymentDate}`);
  drawText(`IP Address: ${clientIp}`);
  drawText(`User Agent: ${userAgent}`);
  y -= 10;

  // Signature
  if (signaturePngBytes) {
    drawText("Signature", { font: fontBold, size: 12 });
    y -= 4;
    if (y < margin + 100) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    try {
      const sigImage = await pdfDoc.embedPng(signaturePngBytes);
      const sigDims = sigImage.scale(0.4);
      const sigWidth = Math.min(sigDims.width, contentWidth);
      const sigHeight = sigDims.height * (sigWidth / sigDims.width);
      page.drawImage(sigImage, { x: margin, y: y - sigHeight, width: sigWidth, height: sigHeight });
      y -= sigHeight + 10;
    } catch (e) {
      console.error("Error embedding signature:", e);
      drawText("[Signature image could not be embedded]");
    }
  }

  // Footer
  y -= 20;
  drawText("This document was generated automatically at the time of payment confirmation.", {
    size: 8,
    color: rgb(0.5, 0.5, 0.5),
  });

  return await pdfDoc.save();
}
