import { describe, expect, it } from "vitest";
import { extractTags, formatTag, hasUnsubscribeTag, insertAtCursor, unknownTags } from "./merge-tags";

describe("merge tags", () => {
  it("formats a tag with and without a fallback", () => {
    expect(formatTag("first_name")).toBe("{{first_name}}");
    expect(formatTag("first_name", "there")).toBe('{{first_name | default: "there"}}');
    expect(formatTag("attr.plan", 'a"b')).toBe('{{attr.plan | default: "ab"}}');
  });

  it("inserts at the caret and replaces a selection", () => {
    expect(insertAtCursor("Hello !", 6, 6, "{{first_name}}")).toEqual({ text: "Hello {{first_name}}!", caret: 20 });
    expect(insertAtCursor("Hello NAME!", 6, 10, "{{first_name}}")).toEqual({ text: "Hello {{first_name}}!", caret: 20 });
    expect(insertAtCursor("abc", 99, 99, "X")).toEqual({ text: "abcX", caret: 4 });
  });

  it("extracts unique tags including defaults and spacing", () => {
    const html = 'Hi {{ first_name | default: "friend" }}, {{first_name}} {{attr.plan}} {{unsubscribe_url}}';
    expect(extractTags(html)).toEqual(["first_name", "attr.plan", "unsubscribe_url"]);
  });

  it("flags tags nothing fills in", () => {
    const html = "{{first_name}} {{attr.plan}} {{attr.tier}} {{nope}} {{view_in_browser_url}}";
    expect(unknownTags(html, ["plan"])).toEqual(["attr.tier", "nope"]);
  });

  it("detects the unsubscribe link", () => {
    expect(hasUnsubscribeTag('<a href="{{unsubscribe_url}}">out</a>')).toBe(true);
    expect(hasUnsubscribeTag("<p>hello</p>")).toBe(false);
  });
});
