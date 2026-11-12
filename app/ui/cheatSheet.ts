// Draws "my cards: which to use where" as an image on the phone, to save or send on WhatsApp.
// Nothing is uploaded: the picture is made in the browser from the playbook rows.
import type { PlaybookRow } from "@/lib/playbook";

const W = 1080;
const PAD = 72;
const ROW = 92;
const C = { bg: "#0d1311", surface: "#151e1b", line: "#26332e", text: "#eef4f1", muted: "#93a39c", accent: "#5ee0a3" };
const FONT = '"Bricolage Grotesque Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 3 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** A PNG of the cheat sheet. `site` is shown in the footer (no personal link is drawn on the image). */
export async function cheatSheetImage(spends: PlaybookRow[], shops: PlaybookRow[], site: string): Promise<Blob> {
  const rows = spends.filter((r) => r.cardName);
  const shopRows = shops.slice(0, 6);
  const H = PAD + 150 + rows.length * ROW + (shopRows.length ? 110 + shopRows.length * ROW : 0) + 150;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic";

  let y = PAD + 56;
  ctx.fillStyle = C.text;
  ctx.font = `700 60px ${FONT}`;
  ctx.fillText("Which card where", PAD, y);
  y += 48;
  ctx.fillStyle = C.muted;
  ctx.font = `400 30px ${FONT}`;
  ctx.fillText("My credit cards, best one for each spend", PAD, y);
  y += 46;

  const drawRows = (list: PlaybookRow[]) => {
    for (const r of list) {
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(PAD, y);
      ctx.lineTo(W - PAD, y);
      ctx.stroke();
      const base = y + 58;
      ctx.fillStyle = C.muted;
      ctx.font = `400 32px ${FONT}`;
      ctx.textAlign = "left";
      ctx.fillText(fit(ctx, r.label, 330), PAD, base);
      ctx.fillStyle = C.accent;
      ctx.font = `700 36px ${FONT}`;
      ctx.textAlign = "right";
      const pct = `${r.pct}%`;
      ctx.fillText(pct, W - PAD, base);
      const pctW = ctx.measureText(pct).width;
      ctx.fillStyle = C.text;
      ctx.font = `600 34px ${FONT}`;
      ctx.textAlign = "left";
      ctx.fillText(fit(ctx, r.cardName ?? "", W - PAD * 2 - 360 - pctW - 24), PAD + 360, base);
      y += ROW;
    }
  };
  drawRows(rows);
  if (shopRows.length) {
    y += 70;
    ctx.fillStyle = C.muted;
    ctx.font = `600 28px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillText("AT SPECIFIC SHOPS", PAD, y);
    y += 40;
    drawRows(shopRows);
  }

  y += 80;
  ctx.textAlign = "left";
  ctx.fillStyle = C.text;
  ctx.font = `600 32px ${FONT}`;
  ctx.fillText("Made with Kaunsa Card", PAD, y);
  ctx.fillStyle = C.muted;
  ctx.font = `400 28px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(site, W - PAD, y);
  y += 40;
  ctx.textAlign = "left";
  ctx.font = `400 24px ${FONT}`;
  ctx.fillText("Rates from the banks' own terms, before monthly limits. Estimates only.", PAD, y);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no image"))), "image/png"));
}
