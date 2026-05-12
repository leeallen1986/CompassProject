/**
 * Tests for emailTemplate.ts — the clean HTML digest email template
 */
import { describe, it, expect } from "vitest";
import { buildDigestEmailHtml, buildDigestEmailText, type EmailSignal, type DigestEmailData } from "./emailTemplate";

const mockSignals: EmailSignal[] = [
  {
    projectId: 101,
    badge: "action_ready",
    title: "Yara Pilbara Ammonia Facility — Advanced Compressor Hire",
    company: "Yara Pilbara Ammonia Plant",
    pitch: "Yara operates a major ammonia production facility in Western Australia, which requires high-performance compressors for nitrogen supply during maintenance shutd",
    ctaAction: "Contact the Maintenance Operations Manager to discuss rental terms and availability.",
    productTag: "Advanced compressor hire for maintenance",
  },
  {
    projectId: 202,
    badge: "action_ready",
    title: "Mundaring Weir Upgrade — Compressor and Light Tower Rental",
    company: "John Holland Pty Ltd.",
    pitch: "The Mundaring Weir Upgrade involves extensive night work and requires reliable compressors and light towers to ensure proper lighting during operations.",
    ctaAction: "Schedule a consultation with the Project Procurement Manager to propose tailored rental packages.",
    productTag: "Compressor and light tower rental for evening construction",
  },
  {
    projectId: 303,
    badge: "discovery_needed",
    title: "Jandakot Water Treatment Plant Expansion — Pump Rental",
    company: "Water Corporation of Western Australia",
    pitch: "The Jandakot facility is expanding and will require additional temporary high-capacity pumps to ensure water flow throughout the upgrade period.",
    ctaAction: "Engage with the Project Engineer to confirm detailed equipment needs and timelines.",
    productTag: "High-capacity pump rental for expansion project",
  },
];

const mockData: DigestEmailData = {
  userName: "Marcus",
  territory: "WA",
  weekLabel: "2026-05-04",
  summaryLine: "2 action-ready opportunities this week.",
  signals: mockSignals,
  dashboardUrl: "https://compasspt.manus.space",
};

describe("buildDigestEmailHtml", () => {
  it("produces valid HTML with DOCTYPE", () => {
    const html = buildDigestEmailHtml(mockData);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
  });

  it("includes the Atlas Copco header branding", () => {
    const html = buildDigestEmailHtml(mockData);
    expect(html).toContain("ATLAS COPCO");
    expect(html).toContain("Power Technique");
  });

  it("includes the recipient greeting", () => {
    const html = buildDigestEmailHtml(mockData);
    expect(html).toContain("Hi Marcus,");
  });

  it("includes the summary line", () => {
    const html = buildDigestEmailHtml(mockData);
    expect(html).toContain("2 action-ready opportunities this week.");
  });

  it("includes THIS WEEK'S SIGNALS section header", () => {
    const html = buildDigestEmailHtml(mockData);
    expect(html).toContain("This week");
  });

  it("renders action_ready badges with green styling", () => {
    const html = buildDigestEmailHtml(mockData);
    expect(html).toContain("Action ready");
    expect(html).toContain("#dcfce7"); // green background
    expect(html).toContain("#166534"); // green text
  });

  it("renders discovery_needed badges with red/coral styling", () => {
    const html = buildDigestEmailHtml(mockData);
    expect(html).toContain("Discovery needed");
    expect(html).toContain("#fee2e2"); // coral background
    expect(html).toContain("#991b1b"); // red text
  });

  it("renders all project titles", () => {
    const html = buildDigestEmailHtml(mockData);
    expect(html).toContain("Yara Pilbara Ammonia Facility");
    expect(html).toContain("Mundaring Weir Upgrade");
    expect(html).toContain("Jandakot Water Treatment Plant Expansion");
  });

  it("renders company names", () => {
    const html = buildDigestEmailHtml(mockData);
    expect(html).toContain("Yara Pilbara Ammonia Plant");
    expect(html).toContain("John Holland Pty Ltd.");
    expect(html).toContain("Water Corporation of Western Australia");
  });

  it("renders pitch paragraphs", () => {
    const html = buildDigestEmailHtml(mockData);
    expect(html).toContain("high-performance compressors for nitrogen supply");
    expect(html).toContain("extensive night work");
  });

  it("renders CTA actions with arrows and teal styling", () => {
    const html = buildDigestEmailHtml(mockData);
    expect(html).toContain("Contact the Maintenance Operations Manager");
    expect(html).toContain("Schedule a consultation");
    expect(html).toContain("Engage with the Project Engineer");
    // Should have teal color and medium weight styling
    expect(html).toContain("color:#0d9488");
    expect(html).toContain("font-weight:500");
  });

  it("renders product tag pills", () => {
    const html = buildDigestEmailHtml(mockData);
    expect(html).toContain("Advanced compressor hire for maintenance");
    expect(html).toContain("Compressor and light tower rental for evening construction");
    expect(html).toContain("High-capacity pump rental for expansion project");
  });

  it("includes the dashboard CTA button linking to Must Act section", () => {
    const html = buildDigestEmailHtml(mockData);
    expect(html).toContain("View your Must Act projects");
    expect(html).toContain("https://compasspt.manus.space/this-week?section=must_act");
  });

  it("includes project links to individual project pages", () => {
    const html = buildDigestEmailHtml(mockData);
    expect(html).toContain("https://compasspt.manus.space/project/101");
    expect(html).toContain("https://compasspt.manus.space/project/202");
    expect(html).toContain("https://compasspt.manus.space/project/303");
  });

  it("includes territory and week in the header", () => {
    const html = buildDigestEmailHtml(mockData);
    expect(html).toContain("WA");
    expect(html).toContain("2026-05-04");
  });

  it("escapes HTML entities in user-provided content", () => {
    const dataWithHtml: DigestEmailData = {
      ...mockData,
      signals: [{
        ...mockSignals[0],
        title: "Project <script>alert('xss')</script>",
        company: "Company & Partners",
      }],
    };
    const html = buildDigestEmailHtml(dataWithHtml);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Company &amp; Partners");
  });

  it("handles empty signals gracefully", () => {
    const emptyData: DigestEmailData = {
      ...mockData,
      signals: [],
      summaryLine: "Here is your weekly intelligence update.",
    };
    const html = buildDigestEmailHtml(emptyData);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("View your Must Act projects");
    expect(html).toContain("Here is your weekly intelligence update.");
    // Should still render without errors
    expect(html.length).toBeGreaterThan(500);
  });
});

describe("buildDigestEmailText", () => {
  it("produces plain text with no HTML tags", () => {
    const text = buildDigestEmailText(mockData);
    expect(text).not.toContain("<");
    expect(text).not.toContain(">");
  });

  it("includes the greeting and summary", () => {
    const text = buildDigestEmailText(mockData);
    expect(text).toContain("Hi Marcus,");
    expect(text).toContain("2 action-ready opportunities this week.");
  });

  it("includes badge labels in brackets", () => {
    const text = buildDigestEmailText(mockData);
    expect(text).toContain("[Action ready]");
    expect(text).toContain("[Discovery needed]");
  });

  it("includes all project titles", () => {
    const text = buildDigestEmailText(mockData);
    expect(text).toContain("Yara Pilbara Ammonia Facility");
    expect(text).toContain("Mundaring Weir Upgrade");
    expect(text).toContain("Jandakot Water Treatment Plant Expansion");
  });

  it("includes CTA actions with arrows", () => {
    const text = buildDigestEmailText(mockData);
    expect(text).toContain("→ Contact the Maintenance Operations Manager");
    expect(text).toContain("→ Engage with the Project Engineer");
  });

  it("includes product tags in brackets", () => {
    const text = buildDigestEmailText(mockData);
    expect(text).toContain("[Advanced compressor hire for maintenance]");
    expect(text).toContain("[High-capacity pump rental for expansion project]");
  });

  it("includes the dashboard URL", () => {
    const text = buildDigestEmailText(mockData);
    expect(text).toContain("https://compasspt.manus.space/");
  });
});
