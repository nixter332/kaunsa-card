import { describe, expect, it } from "vitest";
import { lookupFromTool } from "../lib/claude";

const ok = { merchant: "zomato", merchant_text: "zomato", category: "food_delivery", amount: 650, channel: "online", rail: "card" };

describe("checking what Claude returns", () => {
  it("passes a normal answer through", () => {
    expect(lookupFromTool(ok)).toEqual({ merchant: "zomato", merchantText: "zomato", category: "food_delivery", amount: 650, channel: "online", rail: "card" });
  });
  it("'unknown' or a made-up merchant becomes no merchant", () => {
    expect(lookupFromTool({ ...ok, merchant: "unknown" }).merchant).toBeUndefined();
    expect(lookupFromTool({ ...ok, merchant: "zomato_gold_plus" }).merchant).toBeUndefined();
  });
  it("a bad spend type, channel or rail is rejected so the on-device parser is used", () => {
    expect(() => lookupFromTool({ ...ok, category: "food" })).toThrow(/category/);
    expect(() => lookupFromTool({ ...ok, channel: "app" })).toThrow(/channel/);
    expect(() => lookupFromTool({ ...ok, rail: "credit" })).toThrow(/rail/);
  });
  it("a missing, negative or non-numeric amount becomes 0, so the app asks for it", () => {
    expect(lookupFromTool({ ...ok, amount: undefined }).amount).toBe(0);
    expect(lookupFromTool({ ...ok, amount: -50 }).amount).toBe(0);
    expect(lookupFromTool({ ...ok, amount: "lots" }).amount).toBe(0);
    expect(lookupFromTool({ ...ok, amount: "1200" }).amount).toBe(1200);
  });
});
