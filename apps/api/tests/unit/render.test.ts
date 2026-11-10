import { describe, expect, it } from "vitest";
import { extractLinks, htmlToText, renderEmail, sanitizeHtml, substituteTags, tagsIn } from "../../src/utils/render";

const base = {
  subject: "Hi {{first_name | default: \"friend\"}}",
  html: "<body><p>Hello {{first_name}} {{ attr.plan | default: 'free' }}</p><a href=\"https://example.com/a?x=1&amp;y=2\">go</a></body>",
  contact: { email: "ada@example.com", firstName: "Ada", lastName: "Lovelace", attributes: { plan: "pro" } },
};

describe("merge tags", () => {
  it("substitutes values and defaults", () => {
    const out = renderEmail(base);
    expect(out.subject).toBe("Hi Ada");
    expect(out.html).toContain("Hello Ada pro");
    const anon = renderEmail({ ...base, contact: { email: "x@example.com" } });
    expect(anon.subject).toBe("Hi friend");
    expect(anon.html).toContain("Hello  free");
  });

  it("escapes HTML in values so a name cannot inject markup", () => {
    const out = renderEmail({ ...base, contact: { email: "x@example.com", firstName: "<script>alert(1)</script>" } });
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("&lt;script&gt;");
  });

  it("never evaluates anything: unknown tags render empty and are reported", () => {
    const out = renderEmail({ ...base, html: "<p>{{constructor.constructor('return 1')()}} {{nope}} {{ attr.missing }}</p>" });
    expect(out.missingTags.sort()).toEqual(["attr.missing", "nope"]);
    expect(out.html).not.toContain("nope");
  });

  it("strips CR and LF from the subject so it cannot inject headers", () => {
    const out = renderEmail({ ...base, subject: "A\r\nBcc: x@example.com {{first_name}}" });
    expect(out.subject).not.toMatch(/[\r\n]/);
  });

  it("lists the tags a template uses", () => {
    expect(tagsIn("{{a}} {{ b | default: \"x\" }} {{attr.c}}").sort()).toEqual(["a", "attr.c", "b"]);
  });

  it("substitutes plain text without escaping in text mode", () => {
    expect(substituteTags("{{first_name}}", { ...base }, "text")).toBe("Ada");
    expect(substituteTags("{{first_name}}", { ...base, contact: { email: "a@b.example", firstName: "A&B" } }, "text")).toBe("A&B");
  });
});

describe("links, pixel, footer", () => {
  it("rewrites static http links through the tracker and leaves mailto alone", () => {
    const out = renderEmail({
      ...base,
      html: '<a href="https://example.com/a">a</a><a href="mailto:me@example.com">m</a><a href="https://example.com/b?x={{first_name}}">dyn</a>',
      trackLink: (u) => (u === "https://example.com/a" ? "https://t.example/c/abc" : null),
    });
    expect(out.html).toContain('href="https://t.example/c/abc"');
    expect(out.html).toContain('href="mailto:me@example.com"');
    expect(out.html).toContain("x=Ada");
  });

  it("extracts only static http(s) links", () => {
    expect(extractLinks('<a href="https://example.com/a?x=1&amp;y=2">a</a><a href="/rel">r</a><a href="https://e.example/{{x}}">d</a><a href=\'http://example.com/q\'>q</a>')).toEqual([
      "https://example.com/a?x=1&y=2",
      "http://example.com/q",
    ]);
  });

  it("appends the open pixel and an unsubscribe footer when the template has none", () => {
    const out = renderEmail({ ...base, unsubscribeUrl: "https://u.example/u/tok", pixelUrl: "https://t.example/o/tok.gif", company: { name: "Acme", address: "1 Example St" } });
    expect(out.html).toContain("https://t.example/o/tok.gif");
    expect(out.html).toContain('href="https://u.example/u/tok"');
    expect(out.html).toContain("1 Example St");
    expect(out.text).toContain("Unsubscribe: https://u.example/u/tok");
  });

  it("does not add a second footer when the template carries {{unsubscribe_url}}", () => {
    const out = renderEmail({ ...base, html: '<p><a href="{{unsubscribe_url}}">leave</a></p>', unsubscribeUrl: "https://u.example/u/tok" });
    expect(out.html.match(/u\.example\/u\/tok/g)).toHaveLength(1);
  });

  it("does not track the unsubscribe or view links", () => {
    const out = renderEmail({ ...base, html: '<a href="{{unsubscribe_url}}">u</a>', unsubscribeUrl: "https://u.example/u/tok", trackLink: () => "https://t.example/x" });
    expect(out.html).toContain("https://u.example/u/tok");
  });

  it("puts the preheader in a hidden block", () => {
    const out = renderEmail({ ...base, preheader: "Preview {{first_name}}" });
    expect(out.html).toContain("display:none");
    expect(out.html).toContain("Preview Ada");
  });
});

describe("sanitizer and text", () => {
  it("removes scripts, frames, event handlers and javascript: URLs", () => {
    const dirty = '<p onclick="x()">a</p><script>evil()</script><iframe src="https://e.example"></iframe><a href="javascript:alert(1)">b</a><img src=x onerror=alert(1)>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toMatch(/script|iframe|onclick|onerror|javascript:/i);
  });

  it("derives a readable text part with link targets", () => {
    const t = htmlToText('<h1>Title</h1><p>Hello <a href="https://example.com/x">there</a></p><ul><li>one</li></ul>');
    expect(t).toContain("Title");
    expect(t).toContain("there (https://example.com/x)");
    expect(t).toContain("- one");
  });
});
