// Real alert formats from the owner's banks (Nov 2026), names removed.
import { describe, expect, it } from "vitest";
import cardsJson from "../data/cards.json";
import { cleanDescriptor, GMAIL_QUERY, matchCard, merchantFor, NOT_CARD_PAYMENT, parseAlert, shopKey, txnKey } from "../lib/alerts";
import type { Card } from "../lib/types";

const cards = cardsJson as Card[];
const pick = (...ids: string[]) => cards.filter((c) => ids.includes(c.id));
const istTs = (s: string) => new Date(`${s}+05:30`).getTime();

const SAMPLES = {
  hdfcSms1: "Rs.330 spent on HDFC Bank Card x9016 at PYU*Instamart Grocery on 2026-11-15:11:50:41.Not U? Call 18002586161/SMS BLOCK DC 9016 to 7308080808",
  hdfcSms2: "Spent Rs.312 On HDFC Bank Card 9016 At PTM*SWIGGY IN On 2026-11-08:12:04:19.Not You? To Block+Reissue Call 18002586161/SMS BLOCK CC 9016 to 7308080808",
  hdfcEmail: `Dear Customer,

Greetings from HDFC Bank.

Thank you for using your HDFC Bank Credit Card ending in 9016.You made a transaction of Rs. 330.00 at PYU*Instamart Grocery on 15-11-2026 11:50:41.
Authorization code: 027180

Important Note:
If you did not do this transaction, please act immediately.`,
  axisSms: `Spent INR 373
using Axis Bank Credit Card no. XX0574 on 21-10-26 14:26:17 IST at
AMAZON PAY.
Avl limit: INR 369627. Not you? SMS BLOCK 0574 to +919951860002.`,
  axisEmail: `INR 1553 spent on credit card no. XX0574
22-10-2026
Dear Customer,
Here's the summary of your Axis Bank Credit Card Transaction:
Transaction Amount:
INR 1553
Merchant Name:
PYU*AMAZON
Axis Bank Credit Card No.
XX0574
Date & Time:
22-10-2026, 11:30:27 IST
Available Limit*:
INR 367470`,
  hsbcSms: "HSBC Credit Card xx3845 used at BIG TREE ENTERTAINMENT PR for INR 268.70 on 14/11/26. Avl limit INR 507333.30; due INR 3666.70. Call +914065118002 to report fraud.",
  hsbcEmail: `Dear Customer,

We're writing to confirm that your HSBC Credit Card xx3845 was used for a transaction of INR 1372.00 at JIMIS BURGER LLP on 13/11/26.

Available limit: INR 507602.00
Amount due: INR 3398.00`,
  indusSms: "INR 10,948.34 spent on IndusInd Card XX2196 on 07-11-2026 12:38:45 pm at MAKEMYTRIP COM. Avl Lmt: INR 317,051.66. To dispute, call 18602677777/SMS BLOCK 2196 to 5676757",
  indusEmail: `The transaction on your IndusInd Bank Credit Card ending 2196 for INR 10,948.34 on 07-11-2026 12:38:45 pm at Makemytrip Com is Approved. Available Limit: INR 317,051.66.

In case you have not authorized this transaction, you can block your Credit Card instantly by sending SMS BLOCK 2196 to 5676757.`,
  scapiaSms: "Hi! Your txn of ₹470.79 at Gelato Secret Umf Gianyar on your Scapia Federal Visa credit card was successful. Not you? Go to Scapia support on the app.- Federal Bank",
  scapiaEmail: `Your transaction was successful!

Your payment on 08-11-2026 at 11:49 PM using your Scapia Federal Visa Credit Card ending in 8874 has been successfully processed.


Amount
 \t
₹94.53

Merchant
 \t
Render.com + Us


Not you? Head to Support on the Scapia app or call 18002961199.`,
};

describe("reading bank alerts", () => {
  it("HDFC SMS (both formats) and email", () => {
    expect(parseAlert(SAMPLES.hdfcSms1)).toMatchObject({ issuer: "HDFC Bank", last4: "9016", amount: 330, merchant: { id: "swiggy_instamart" }, ts: istTs("2026-11-15T11:50:41") });
    expect(parseAlert(SAMPLES.hdfcSms2)).toMatchObject({ issuer: "HDFC Bank", last4: "9016", amount: 312, merchant: { id: "swiggy_food" }, ts: istTs("2026-11-08T12:04:19") });
    expect(parseAlert(SAMPLES.hdfcEmail)).toMatchObject({ issuer: "HDFC Bank", last4: "9016", amount: 330, merchant: { id: "swiggy_instamart" }, ts: istTs("2026-11-15T11:50:41") });
  });
  it("Axis SMS and email (labelled fields)", () => {
    expect(parseAlert(SAMPLES.axisSms)).toMatchObject({ issuer: "Axis Bank", last4: "0574", amount: 373, merchant: { id: "amazon" }, ts: istTs("2026-10-21T14:26:17") });
    expect(parseAlert(SAMPLES.axisEmail)).toMatchObject({ issuer: "Axis Bank", last4: "0574", amount: 1553, merchantRaw: "PYU*AMAZON", merchant: { id: "amazon" }, ts: istTs("2026-10-22T11:30:27") });
  });
  it("HSBC: a company name maps to the brand; an unknown restaurant stays unknown", () => {
    expect(parseAlert(SAMPLES.hsbcSms)).toMatchObject({ issuer: "HSBC", last4: "3845", amount: 268.7, merchant: { id: "bookmyshow" } });
    const e = parseAlert(SAMPLES.hsbcEmail)!;
    expect(e).toMatchObject({ issuer: "HSBC", last4: "3845", amount: 1372, merchantRaw: "JIMIS BURGER LLP" });
    expect(e.merchant).toBeUndefined();
  });
  it("IndusInd SMS and email, with 12-hour times", () => {
    for (const t of [SAMPLES.indusSms, SAMPLES.indusEmail])
      expect(parseAlert(t)).toMatchObject({ issuer: "IndusInd Bank", last4: "2196", amount: 10948.34, merchant: { id: "makemytrip" }, ts: istTs("2026-11-07T12:38:45") });
  });
  it("Scapia: issuer is Federal Bank; SMS has no last 4 digits; the email's '11:49 PM' isn't a shop", () => {
    expect(parseAlert(SAMPLES.scapiaSms)).toMatchObject({ issuer: "Federal Bank", cardHint: "visa", amount: 470.79, merchantRaw: "Gelato Secret Umf Gianyar" });
    expect(parseAlert(SAMPLES.scapiaSms)!.last4).toBeUndefined();
    expect(parseAlert(SAMPLES.scapiaEmail)).toMatchObject({ issuer: "Federal Bank", last4: "8874", amount: 94.53, merchantRaw: "Render.com + Us", ts: istTs("2026-11-08T23:49:00") });
  });
  it("ignores OTPs, refunds, payments received and promos", () => {
    expect(parseAlert("123456 is your OTP for a transaction of INR 500 at AMAZON on HDFC Bank Card x9016")).toBeUndefined();
    expect(parseAlert("Refund of INR 500 from AMAZON credited to your HDFC Bank Credit Card x9016")).toBeUndefined();
    expect(parseAlert("Payment of Rs. 5,000 has been received on your HDFC Bank Credit Card x9016")).toBeUndefined();
    expect(parseAlert("Get 10% off at Myntra with your HDFC Bank Credit Card! Shop now.")).toBeUndefined();
  });
  it("strips gateway prefixes and company suffixes", () => {
    expect(cleanDescriptor("PYU*Instamart Grocery")).toBe("Instamart Grocery");
    expect(cleanDescriptor("PTM*SWIGGY IN")).toBe("SWIGGY");
    expect(merchantFor("RESTAURANT XYZ")).toBeUndefined(); // the catch-all "Restaurant" isn't guessed from a name
  });
});

describe("matching an alert to a card", () => {
  const mine = pick("swiggy-hdfc", "flipkart-axis", "hsbc-live-plus", "indusind-tiger", "scapia-visa", "scapia-rupay");
  it("the only card from that issuer is matched without asking", () => {
    expect(matchCard(parseAlert(SAMPLES.hdfcSms1)!, mine, {})?.id).toBe("swiggy-hdfc");
    expect(matchCard(parseAlert(SAMPLES.axisSms)!, mine, {})?.id).toBe("flipkart-axis");
  });
  it("two Scapia cards: the network word ('Visa') decides", () => {
    expect(matchCard(parseAlert(SAMPLES.scapiaSms)!, mine, {})?.id).toBe("scapia-visa");
  });
  it("two cards from one bank with no hint: ask, unless the last 4 digits are linked", () => {
    const two = pick("swiggy-hdfc", "hdfc-millennia");
    const t = parseAlert(SAMPLES.hdfcSms1)!;
    expect(matchCard(t, two, {})).toBeUndefined();
    expect(matchCard(t, two, { "hdfc-millennia": "9016" })?.id).toBe("hdfc-millennia");
    // A card linked to other digits is ruled out, leaving one candidate.
    expect(matchCard(t, two, { "hdfc-millennia": "1111" })?.id).toBe("swiggy-hdfc");
  });
  it("the same payment from SMS and email gets one key", () => {
    const a = parseAlert(SAMPLES.hdfcSms1)!;
    const b = parseAlert(SAMPLES.hdfcEmail)!;
    expect(txnKey(a, "swiggy-hdfc")).toBe(txnKey(b, "swiggy-hdfc"));
  });
});

describe("the Gmail search", () => {
  it("leaves out account debits, UPI account alerts, OTPs, EMI schedules and statements, but no supported card alert", () => {
    for (const x of NOT_CARD_PAYMENT) expect(GMAIL_QUERY).toContain(`-${x}`);
    const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9₹]+/g, " ").trim();
    for (const x of NOT_CARD_PAYMENT) {
      if (x.startsWith("category:")) continue;
      const phrase = words(x.replace(/^subject:/, "").replace(/"/g, ""));
      for (const [name, text] of Object.entries(SAMPLES)) expect(` ${words(text)} `, `${x} would hide ${name}`).not.toContain(` ${phrase} `);
    }
  });
  it("remembers a shop by its cleaned name", () => {
    expect(shopKey("JIMIS BURGER LLP")).toBe("JIMIS BURGER");
    expect(shopKey("Jimis Burger Llp")).toBe("JIMIS BURGER"); // payments imported before 15 Nov 2026 only kept this label
  });
});
