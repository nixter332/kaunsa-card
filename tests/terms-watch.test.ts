import { describe, expect, it } from "vitest";
import cards from "../data/cards.json";
import catalog from "../data/catalog.json";
import {
  cardsToRecheck,
  diffWatch,
  isWatchable,
  unwatchedCards,
  watchText,
} from "../lib/termsWatch";
import { findMerchant } from "../lib/localParse";

describe("terms watch", () => {
  it("watches issuer pages, not saved files or review sites", () => {
    expect(isWatchable("https://www.axis.bank.in/docs/x.pdf")).toBe(true);
    expect(isWatchable("C:\\Users\\me\\Downloads\\terms.pdf")).toBe(false);
    expect(isWatchable("https://cardadvisor.in/cards/hdfc-swiggy")).toBe(false);
    expect(isWatchable("https://www.paisabazaar.com/x")).toBe(false);
  });

  it("first run only records; a later change flags the cards using that document", () => {
    const a = "https://bank.example/a.pdf";
    const b = "https://bank.example/b";
    const first = diffWatch(
      {},
      { [a]: { hash: "1" }, [b]: { hash: "2" } },
      "2026-12-01",
    );
    expect(first.changed).toEqual([]);
    expect(first.baselined).toHaveLength(2);
    const next = diffWatch(
      first.state,
      { [a]: { hash: "1" }, [b]: { hash: "3" } },
      "2027-01-01",
    );
    expect(next.changed).toEqual([b]);
    expect(next.state[b].lastChanged).toBe("2027-01-01");
    expect(next.state[a].lastChanged).toBe("2026-12-01");
    const ids = cardsToRecheck(
      [
        { id: "x", sources: [{ url: a }] },
        { id: "y", sources: [{ url: b }] },
      ],
      next.changed,
    );
    expect(ids).toEqual(["y"]);
  });

  it("an unreachable page keeps last month's fingerprint", () => {
    const a = "https://bank.example/a.pdf";
    const first = diffWatch({}, { [a]: { hash: "1" } }, "2026-12-01");
    const next = diffWatch(
      first.state,
      { [a]: { error: "403" } },
      "2027-01-01",
    );
    expect(next.unreachable).toHaveLength(1);
    expect(next.state[a].hash).toBe("1");
  });

  it("ignores whitespace and copyright-year changes", () => {
    expect(watchText("5%  Cashback\n© 2025")).toBe(
      watchText("5% cashback © 2026"),
    );
  });

  it("every card in the app has at least one watched issuer source", () => {
    expect(
      unwatchedCards(cards as { id: string; sources: { url: string }[] }[]),
    ).toEqual([]);
  });
});

describe("new cards and merchants", () => {
  it("a named fuel brand beats the generic fuel station", () => {
    expect(findMerchant("petrol at bpcl 2000")?.id).toBe("bpcl");
    expect(findMerchant("hp petrol 1500")?.id).toBe("hpcl");
    expect(findMerchant("petrol 500")?.id).toBe("petrol");
  });
  it("direct airline and hotel bookings are their own merchants", () => {
    expect(findMerchant("indigo flight 6000")?.id).toBe("airline");
    expect(findMerchant("goibibo flight 6000")?.id).toBe("goibibo");
    expect(findMerchant("marriott stay 9000")?.id).toBe("hotel");
  });
  it("catalog has the new cards with issuer sources", () => {
    const ids = (catalog as { id: string }[]).map((c) => c.id);
    for (const id of [
      "sbi-simplyclick",
      "hdfc-moneyback-plus",
      "axis-atlas",
      "amex-mrcc",
      "bpcl-sbi-octane",
      "icici-hpcl-super-saver",
    ])
      expect(ids).toContain(id);
    for (const c of catalog as { id: string; sources: string[] }[])
      expect(c.sources.some(isWatchable), c.id).toBe(true);
  });
});
