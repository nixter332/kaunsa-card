import { describe, expect, it } from "vitest";
import sourcesJson from "../data/offer-sources.json";
import { mentionsKnownShop, offerLinks, type OfferSource } from "../lib/offerLinks";

const page = `
  <a href="/offers/makemytrip-offers/get-up-to-25-percent-discount">Know More</a>
  <a href="https://www.axis.bank.in/offers/makemytrip-offers/long-weekend-offer">Know More</a>
  <a href="/offers/makemytrip-offers/get-up-to-25-percent-discount#terms">Know More</a>
  <a href="/offers/makemytrip-offers">All MakeMyTrip offers</a>
  <a href="https://evil.example.com/offers/makemytrip-offers/x">Elsewhere</a>
  <a href="/cards/credit-card">Apply</a>`;

describe("following offer links", () => {
  it("keeps same-site offer pages, once each, and skips the list page itself", () => {
    const links = offerLinks(page, "https://www.axis.bank.in/offers/makemytrip-offers", { follow: "/offers/makemytrip-offers/", onlyKnownShops: false });
    expect(links.map((l) => l.url)).toEqual([
      "https://www.axis.bank.in/offers/makemytrip-offers/get-up-to-25-percent-discount",
      "https://www.axis.bank.in/offers/makemytrip-offers/long-weekend-offer",
    ]);
  });

  it("can keep only links that mention a shop the app knows", () => {
    const html = `<a href="/offers/swiggy-dineout-offer">Swiggy Dineout</a><a href="/offers/lulu-hypermarket">Lulu</a><a href="/offers/x1">Flat 10% on Myntra</a>`;
    const links = offerLinks(html, "https://www.icici.bank.in/offers/credit-card.html", { follow: "/offers/" });
    expect(links.map((l) => l.text)).toEqual(["Swiggy Dineout", "Flat 10% on Myntra"]);
    expect(mentionsKnownShop("makemytrip-flight-offer")).toBe(true);
    expect(mentionsKnownShop("lulu hypermarket")).toBe(false);
  });

  it("respects the link limit and needs a follow pattern", () => {
    const many = Array.from({ length: 20 }, (_, i) => `<a href="/offers/myntra-${i}">Myntra ${i}</a>`).join("");
    expect(offerLinks(many, "https://x.in/offers", { follow: "/offers/", maxLinks: 5 })).toHaveLength(5);
    expect(offerLinks(many, "https://x.in/offers", {})).toEqual([]);
  });

  it("every source in data/offer-sources.json is well formed", () => {
    for (const s of sourcesJson as OfferSource[]) {
      expect(s.url, s.id).toMatch(/^https:\/\//);
      if (s.follow) expect(s.follow, s.id).toMatch(/^\//);
    }
  });
});
