// The link preview LinkedIn and WhatsApp show for the app: the tags in app/layout.tsx and the picture from
// app/opengraph-image.tsx. Without them a shared link shows up as a bare URL.
import { describe, expect, it } from "vitest";
import { metadata } from "../app/layout";
import OpenGraphImage, { size } from "../app/opengraph-image";
import { recommend } from "../lib/engine";
import { cardById } from "../app/ui/store";
import type { Card } from "../lib/types";

describe("link preview", () => {
  it("has full-URL Open Graph and large-image tags", () => {
    expect(metadata.metadataBase?.toString()).toMatch(/^https:\/\//);
    expect(metadata.openGraph).toMatchObject({ title: metadata.title, siteName: "Kaunsa Card", type: "website" });
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("the picture's example still has a winning card (else its answer box would quietly disappear)", () => {
    const fan = ["flipkart-axis", "swiggy-hdfc", "hsbc-live-plus"].map(cardById).filter((c): c is Card => Boolean(c));
    expect(fan).toHaveLength(3);
    const best = recommend(fan, { merchant: "zomato", category: "food_delivery", amount: 600, channel: "online", rail: "card" }).find((r) => r.usable);
    expect(best?.totalInr).toBeGreaterThan(0);
  });

  it("draws a 1200×630 PNG", async () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    const res = OpenGraphImage();
    const png = new Uint8Array(await res.arrayBuffer());
    expect([...png.slice(1, 4)].map((b) => String.fromCharCode(b)).join("")).toBe("PNG");
    expect(png.byteLength).toBeGreaterThan(20_000);
  });
});
