import { describe, expect, it } from "vitest";
import { decodeEntities, htmlToText } from "../src/lib/html.ts";

describe("decodeEntities", () => {
  it.each([
    ["&lt;b&gt;", "<b>"],
    ["Tom &amp; Jerry", "Tom & Jerry"],
    ["&#39;quoted&#39;", "'quoted'"],
    ["&#x2014;", "—"],
    ["&unknown;", "&unknown;"],
  ])("%s -> %s", (input, expected) => {
    expect(decodeEntities(input)).toBe(expected);
  });
});

describe("htmlToText", () => {
  it("turns escaped Greenhouse HTML into plain text", () => {
    expect(
      htmlToText(
        "&lt;h2&gt;About&lt;/h2&gt;&lt;p&gt;We pay &amp;amp; ship&lt;/p&gt;",
      ),
    ).toBe("About\nWe pay & ship");
  });
});
