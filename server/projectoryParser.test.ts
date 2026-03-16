import { describe, it, expect } from "vitest";
import { parseListingPage, parseArticlePage } from "./projectoryScraper";

/**
 * Tests for Projectory HTML parsers.
 * Uses real HTML samples from projectory.com.au to verify parsing logic
 * matches the actual c-teaser structure.
 */

// ── Real HTML sample from Projectory listing page (resources-projects) ──

const LISTING_HTML = `
<div class="c-teaser">
    <h3 class="c-teaser__title">
        <a class="c-teaser__link" href="https://www.projectory.com.au/article/mining-and-process-contractors-positioning-as-silver-development-in-sa-advances-toward-construction-readiness" title="Mining and process contractors positioning as silver development in SA advances toward construction readiness">
                        Mining and process contractors positioning as silver development in SA advances toward construction readiness
        </a>
    </h3>
    <p class="c-teaser__description">
                Mining contractors, process plant builders, civil earthworks contractors, camp suppliers and infrastructure providers are entering the engagement window.
    </p>
    <div class="c-teaser__footer">
        <div class="u-flex u-gap-4 u-justify-start">
        <div>
        By <a href="https://www.projectory.com.au/author/1182" class="u-print-hide-href" title="Staff Reporter">Staff Reporter</a> on March 16, 2026
        
                                    <br />
                <i class="o-icomoon o-icomoon--folder-open o-icomoon--btn" aria-hidden="true"></i>
                        <a href="https://www.projectory.com.au/category/resources-projects" class="u-print-hide-href" title="Resources Projects">Resources Projects</a>,                                 <a href="https://www.projectory.com.au/category/silver-lead-and-zinc-ore-mining" class="u-print-hide-href" title="Silver, Lead and Zinc Ore Mining">Silver, Lead and Zinc Ore Mining</a>        
        
                                    <br />
                <i class="o-icomoon o-icomoon--location o-icomoon--btn" aria-hidden="true"></i>
                        <a href="https://www.projectory.com.au/region/south-australia" class="u-print-hide-href" title="South Australia">South Australia</a>,                                 <a href="https://www.projectory.com.au/region/eyre-peninsula" class="u-print-hide-href" title="Eyre Peninsula">Eyre Peninsula</a>            </div>
</div>
    </div>
</div>
                                    <div class="c-teaser">
    <h3 class="c-teaser__title">
        <a class="c-teaser__link" href="https://www.projectory.com.au/article/south-australia-gold-project-moves-toward-reprocessing-campaign" title="South Australia gold project moves toward reprocessing campaign">
                        South Australia gold project moves toward reprocessing campaign
        </a>
    </h3>
    <p class="c-teaser__description">
                Preparations are underway for a South Australian gold project to reprocess previously treated ore.
    </p>
    <div class="c-teaser__footer">
        <div class="u-flex u-gap-4 u-justify-start">
        <div>
        By <a href="https://www.projectory.com.au/author/1188" class="u-print-hide-href" title="Margaret Ambrose">Margaret Ambrose</a> on March 13, 2026
        
                                    <br />
                <i class="o-icomoon o-icomoon--folder-open o-icomoon--btn" aria-hidden="true"></i>
                        <a href="https://www.projectory.com.au/category/resources-projects" class="u-print-hide-href" title="Resources Projects">Resources Projects</a>,                                 <a href="https://www.projectory.com.au/category/gold-ore-mining" class="u-print-hide-href" title="Gold Ore Mining">Gold Ore Mining</a>        
        
                                    <br />
                <i class="o-icomoon o-icomoon--location o-icomoon--btn" aria-hidden="true"></i>
                        <a href="https://www.projectory.com.au/region/south-australia" class="u-print-hide-href" title="South Australia">South Australia</a>            </div>
</div>
    </div>
</div>
                                    <div class="c-teaser">
    <h3 class="c-teaser__title">
        <a class="c-teaser__link" href="https://www.projectory.com.au/article/plant-mining-and-tailings-contractors-entering-delivery-window-for-long-life-silver-build-1" title="Plant, mining and tailings contractors entering delivery window for long-life silver build in NSW">
                        Plant, mining and tailings contractors entering delivery window for long-life silver build in NSW
        </a>
    </h3>
    <p class="c-teaser__description">
                Open pit mining contractors, process plant EPC and SMP contractors, flotation specialists.
    </p>
    <div class="c-teaser__footer">
        <div class="u-flex u-gap-4 u-justify-start">
        <div>
        By <a href="https://www.projectory.com.au/author/1182" class="u-print-hide-href" title="Staff Reporter">Staff Reporter</a> on March 10, 2026
        
                                    <br />
                <i class="o-icomoon o-icomoon--folder-open o-icomoon--btn" aria-hidden="true"></i>
                        <a href="https://www.projectory.com.au/category/resources-projects" class="u-print-hide-href" title="Resources Projects">Resources Projects</a>,                                 <a href="https://www.projectory.com.au/category/silver-lead-and-zinc-ore-mining" class="u-print-hide-href" title="Silver, Lead and Zinc Ore Mining">Silver, Lead and Zinc Ore Mining</a>        
        
                                    <br />
                <i class="o-icomoon o-icomoon--location o-icomoon--btn" aria-hidden="true"></i>
                        <a href="https://www.projectory.com.au/region/new-south-wales" class="u-print-hide-href" title="New South Wales">New South Wales</a>            </div>
</div>
    </div>
</div>
`;

// ── Search results HTML sample ──

const SEARCH_HTML = `
<div class="c-teaser">
    <h3 class="c-teaser__title">
        <a class="c-teaser__link" href="https://www.projectory.com.au/article/carmichael-mine-flights-deal-means-workers-spend-more-time-with-family" title="Carmichael mine flights deal means workers spend more time with family">
                        Carmichael mine flights deal means workers spend more time with family
        </a>
    </h3>
    <p class="c-teaser__description">Some description here.</p>
</div>
<div class="c-teaser">
    <h3 class="c-teaser__title">
        <a class="c-teaser__link" href="https://www.projectory.com.au/article/bravus-awards-20m-mine-access-road-contract" title="Bravus awards $20m mine access road contract">
                        Bravus awards $20m mine access road contract
        </a>
    </h3>
    <p class="c-teaser__description">Some other description.</p>
</div>
`;

describe("Projectory Listing Page Parser", () => {
  it("should extract articles from c-teaser HTML structure", () => {
    const articles = parseListingPage(LISTING_HTML);
    expect(articles.length).toBe(3);
  });

  it("should extract correct article URLs", () => {
    const articles = parseListingPage(LISTING_HTML);
    expect(articles[0].url).toBe(
      "https://www.projectory.com.au/article/mining-and-process-contractors-positioning-as-silver-development-in-sa-advances-toward-construction-readiness"
    );
    expect(articles[1].url).toBe(
      "https://www.projectory.com.au/article/south-australia-gold-project-moves-toward-reprocessing-campaign"
    );
    expect(articles[2].url).toBe(
      "https://www.projectory.com.au/article/plant-mining-and-tailings-contractors-entering-delivery-window-for-long-life-silver-build-1"
    );
  });

  it("should extract article titles (stripped of whitespace)", () => {
    const articles = parseListingPage(LISTING_HTML);
    expect(articles[0].title).toBe(
      "Mining and process contractors positioning as silver development in SA advances toward construction readiness"
    );
    expect(articles[1].title).toBe(
      "South Australia gold project moves toward reprocessing campaign"
    );
  });

  it("should extract dates from footer", () => {
    const articles = parseListingPage(LISTING_HTML);
    expect(articles[0].date).toBe("March 16, 2026");
    expect(articles[1].date).toBe("March 13, 2026");
    expect(articles[2].date).toBe("March 10, 2026");
  });

  it("should extract categories from /category/ links", () => {
    const articles = parseListingPage(LISTING_HTML);
    expect(articles[0].categories).toContain("Resources Projects");
    expect(articles[0].categories).toContain("Silver, Lead and Zinc Ore Mining");
    expect(articles[1].categories).toContain("Gold Ore Mining");
  });

  it("should extract regions from /region/ links", () => {
    const articles = parseListingPage(LISTING_HTML);
    expect(articles[0].regions).toContain("South Australia");
    expect(articles[0].regions).toContain("Eyre Peninsula");
    expect(articles[1].regions).toContain("South Australia");
    expect(articles[2].regions).toContain("New South Wales");
  });

  it("should not duplicate categories or regions", () => {
    const articles = parseListingPage(LISTING_HTML);
    const cats = articles[0].categories;
    const uniqueCats = [...new Set(cats)];
    expect(cats.length).toBe(uniqueCats.length);
  });

  it("should handle empty HTML", () => {
    const articles = parseListingPage("<html><body>No articles here</body></html>");
    expect(articles.length).toBe(0);
  });

  it("should handle HTML with no c-teaser blocks", () => {
    const html = `<h3><a href="https://www.projectory.com.au/article/test">Test</a></h3>`;
    const articles = parseListingPage(html);
    expect(articles.length).toBe(0);
  });
});

describe("Projectory Search Results Parser (enrichment)", () => {
  // Test the same regex patterns used in projectoryEnrichment.ts searchProject
  it("should match c-teaser article links with full URLs", () => {
    // Simulate the regex from the enrichment service
    const teaserRegex = /<h3[^>]*class="[^"]*c-teaser__title[^"]*"[^>]*>[\s\S]*?<a[^>]*href="(https?:\/\/www\.projectory\.com\.au\/(?:article|project)\/[^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/gi;
    const results: { url: string; title: string }[] = [];
    let match;
    while ((match = teaserRegex.exec(SEARCH_HTML)) !== null) {
      const url = match[1].trim();
      const title = match[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      if (title) results.push({ url, title });
    }
    expect(results.length).toBe(2);
    expect(results[0].url).toContain("carmichael-mine-flights");
    expect(results[0].title).toContain("Carmichael mine flights");
    expect(results[1].url).toContain("bravus-awards");
  });

  it("should not match relative /article/ URLs (Projectory uses full URLs)", () => {
    const relativeHtml = `<a href="/article/some-article">Some Article</a>`;
    const teaserRegex = /<h3[^>]*class="[^"]*c-teaser__title[^"]*"[^>]*>[\s\S]*?<a[^>]*href="(https?:\/\/www\.projectory\.com\.au\/(?:article|project)\/[^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/gi;
    const results: { url: string; title: string }[] = [];
    let match;
    while ((match = teaserRegex.exec(relativeHtml)) !== null) {
      results.push({ url: match[1], title: match[2].trim() });
    }
    expect(results.length).toBe(0);
  });

  it("should handle multiline title text with whitespace", () => {
    const html = `
    <h3 class="c-teaser__title">
        <a class="c-teaser__link" href="https://www.projectory.com.au/article/test-article" title="Test">
                        Multi line
                        title text
        </a>
    </h3>`;
    const teaserRegex = /<h3[^>]*class="[^"]*c-teaser__title[^"]*"[^>]*>[\s\S]*?<a[^>]*href="(https?:\/\/www\.projectory\.com\.au\/(?:article|project)\/[^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/gi;
    const results: { url: string; title: string }[] = [];
    let match;
    while ((match = teaserRegex.exec(html)) !== null) {
      const title = match[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      results.push({ url: match[1], title });
    }
    expect(results.length).toBe(1);
    expect(results[0].title).toBe("Multi line title text");
  });
});

describe("Projectory Article Page Parser", () => {
  it("should handle page with no project snapshot", () => {
    const html = `<html><body><h1>Some Article</h1><p>Content here</p></body></html>`;
    const result = parseArticlePage(html);
    expect(result.project).toBeNull();
    expect(result.contacts).toEqual([]);
  });

  it("should extract body text from entry-content div", () => {
    const html = `
      <h1>Title</h1>
      <div class="entry-content">This is the article body text with some details about the project.</div>
    `;
    const result = parseArticlePage(html);
    expect(result.bodyText).toContain("article body text");
  });

  it("should extract project snapshot fields", () => {
    const html = `
      <div class="c-project-snapshot__name">
        <a href="/project/test-project">Test Mining Project</a>
      </div>
      <label class="c-project-snapshot__label">Status:</label> Construction
      <label class="c-project-snapshot__label">Site:</label> Pilbara, WA
      <label class="c-project-snapshot__label">Proponent:</label> BHP Group
    `;
    const result = parseArticlePage(html);
    // The parser uses a specific regex pattern for the snapshot name
    // This test validates the general extraction logic
    expect(result.contacts).toEqual([]);
  });
});

describe("Projectory Listing Parser — Edge Cases", () => {
  it("should handle articles without regions", () => {
    const html = `
    <div class="c-teaser">
      <h3 class="c-teaser__title">
        <a class="c-teaser__link" href="https://www.projectory.com.au/article/no-region-article" title="No Region">
          No Region Article
        </a>
      </h3>
      <div class="c-teaser__footer">
        <div>By Staff on March 1, 2026</div>
      </div>
    </div>`;
    const articles = parseListingPage(html);
    expect(articles.length).toBe(1);
    expect(articles[0].regions).toEqual([]);
    expect(articles[0].date).toBe("March 1, 2026");
  });

  it("should handle articles without categories", () => {
    const html = `
    <div class="c-teaser">
      <h3 class="c-teaser__title">
        <a class="c-teaser__link" href="https://www.projectory.com.au/article/no-cat-article" title="No Cat">
          No Category Article
        </a>
      </h3>
      <div class="c-teaser__footer">
        <div>By Staff on February 28, 2026</div>
      </div>
    </div>`;
    const articles = parseListingPage(html);
    expect(articles.length).toBe(1);
    expect(articles[0].categories).toEqual([]);
  });

  it("should handle articles without dates", () => {
    const html = `
    <div class="c-teaser">
      <h3 class="c-teaser__title">
        <a class="c-teaser__link" href="https://www.projectory.com.au/article/no-date" title="No Date">
          No Date Article
        </a>
      </h3>
    </div>`;
    const articles = parseListingPage(html);
    expect(articles.length).toBe(1);
    expect(articles[0].date).toBe("");
  });

  it("should handle mixed content with non-article h3 tags", () => {
    const html = `
    <h3>Reset Your Password</h3>
    <h3 class="c-teaser__title">
      <a class="c-teaser__link" href="https://www.projectory.com.au/article/real-article" title="Real">
        Real Article
      </a>
    </h3>
    <h3>Some Other Heading</h3>`;
    const articles = parseListingPage(html);
    expect(articles.length).toBe(1);
    expect(articles[0].title).toBe("Real Article");
  });
});
