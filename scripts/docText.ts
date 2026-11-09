// Plain text of an issuer document (web page, PDF link, or a PDF saved on this laptop), for checking quotes.
import fs from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8377;|&#x20b9;/gi, "₹")
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/\s+/g, " ");
}

export async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

const isPdf = (bytes: Uint8Array) => Buffer.from(bytes.subarray(0, 5)).toString() === "%PDF-";

/** Throws if the document can't be read. */
export async function docText(src: string, timeoutMs = 45_000): Promise<string> {
  if (/^https?:\/\//i.test(src)) {
    const res = await fetch(src, {
      headers: { "User-Agent": "Mozilla/5.0 (cardswipe evidence check)" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    return isPdf(bytes) ? pdfText(bytes) : htmlToText(Buffer.from(bytes).toString("utf8"));
  }
  const bytes = new Uint8Array(fs.readFileSync(src));
  return isPdf(bytes) ? pdfText(bytes) : src.endsWith(".html") ? htmlToText(Buffer.from(bytes).toString("utf8")) : Buffer.from(bytes).toString("utf8");
}
