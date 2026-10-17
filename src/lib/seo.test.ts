import { describe, expect, test } from "bun:test";

const html = await Bun.file(new URL("../../index.html", import.meta.url)).text();

describe("SEO / social meta", () => {
  test("title and description present", () => {
    expect(html).toContain("<title>CodeAtlas</title>");
    expect(html).toContain('name="description"');
  });
  test("Open Graph tags present", () => {
    for (const tag of ["og:type", "og:site_name", "og:title", "og:description", "og:image", "og:image:width", "og:image:height"]) {
      expect(html).toContain(`property="${tag}"`);
    }
  });
  test("Twitter card tags present", () => {
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('name="twitter:title"');
    expect(html).toContain('name="twitter:description"');
    expect(html).toContain('name="twitter:image"');
  });
  test("og:image asset exists and robots.txt allows crawling", async () => {
    const og = Bun.file(new URL("../../public/og-image.png", import.meta.url));
    expect(await og.exists()).toBe(true);
    expect(og.size).toBeGreaterThan(5000);
    const robots = await Bun.file(new URL("../../public/robots.txt", import.meta.url)).text();
    expect(robots).toContain("Allow: /");
  });
});
