import { describe, expect, it } from "vitest";
import {
  buildProjectBuyerRoute,
  type BuyerRouteContactRecord,
  type ProjectBuyerRouteInputs,
} from "./projectBuyerRoute";

const PROJECT_ID = 3_780_038;

function contact(
  overrides: Partial<BuyerRouteContactRecord> &
    Pick<BuyerRouteContactRecord, "id" | "name">
): BuyerRouteContactRecord {
  return {
    id: overrides.id,
    name: overrides.name,
    title: "Project Manager",
    company: "Georgiou Group",
    email: null,
    linkedin: null,
    linkedinProfileUrl: null,
    linkedinSearchUrl: null,
    enrichmentSource: "linkedin",
    sourceUrl: null,
    enrichedAt: null,
    verificationStatus: "unverified",
    emailVerified: false,
    verifiedAt: null,
    contactTrustTier: "named_unverified",
    rejectionReason: null,
    crmOrphan: false,
    createdAt: new Date("2026-07-30T00:00:00.000Z"),
    ...overrides,
  };
}

function gawssInputs(): ProjectBuyerRouteInputs {
  return {
    project: {
      id: PROJECT_ID,
      owner: "Water Corporation",
      contractors: [
        {
          name: "Georgiou Group",
          status: "confirmed",
          detail: "Stage 1 works",
        },
        {
          name: "SRG Global / WBHO Infrastructure JV",
          status: "confirmed",
          detail: "Recorded project package",
        },
      ],
      sources: [
        {
          label: "Project source",
          url: "https://example.test/project",
          date: "2026-07-01",
        },
      ],
    },
    contractorLinks: [
      {
        contractorId: 10,
        canonicalName: "Georgiou Group",
        aliases: ["Georgiou"],
        role: "contractor",
        status: "confirmed",
        detail: "Stage 1 works",
        confidence: 90,
        source: "seed_data",
        createdAt: new Date("2026-07-02T00:00:00.000Z"),
      },
      {
        contractorId: 11,
        canonicalName: "SRG Global / WBHO Infrastructure JV",
        aliases: null,
        role: "contractor",
        status: "confirmed",
        detail: "Recorded project package",
        confidence: 90,
        source: "seed_data",
        createdAt: new Date("2026-07-02T00:00:00.000Z"),
      },
    ],
    contacts: [
      {
        contact: contact({
          id: 1,
          name: "Verified Fleet Contact",
          title: "Fleet Manager",
          email: " verified@example.test ",
          emailVerified: true,
          verificationStatus: "verified",
          verifiedAt: new Date("2026-08-01T00:00:00.000Z"),
          contactTrustTier: "send_ready",
          linkedinProfileUrl: "https://www.linkedin.com/in/verified",
          sourceUrl: "https://linkedin.example/verified",
        }),
        link: {
          relevance: "primary",
          createdAt: new Date("2026-07-31T00:00:00.000Z"),
        },
      },
      {
        contact: contact({
          id: 2,
          name: "Unsupported Send Ready Label",
          title: "Procurement Manager",
          company: "Unproven Employer",
          email: "must-not-leak@example.test",
          contactTrustTier: "send_ready",
          emailVerified: false,
          verificationStatus: "unverified",
          enrichedAt: new Date("2026-07-29T00:00:00.000Z"),
        }),
        link: {
          relevance: "secondary",
          createdAt: new Date("2026-07-29T00:00:00.000Z"),
        },
      },
      {
        contact: contact({
          id: 3,
          name: "LLM Suggested Person",
          company: "Unproven Employer",
          email: "also-hidden@example.test",
          enrichmentSource: "llm",
          contactTrustTier: "llm_inferred",
        }),
        link: {
          relevance: "secondary",
          createdAt: new Date("2026-07-30T00:00:00.000Z"),
        },
      },
      {
        contact: contact({
          id: 4,
          name: "CRM Orphan With Stale Ready Label",
          email: "crm-orphan-must-not-leak@example.test",
          emailVerified: true,
          verificationStatus: "verified",
          contactTrustTier: "send_ready",
          crmOrphan: true,
        }),
        link: {
          relevance: "secondary",
          createdAt: new Date("2026-07-30T00:00:00.000Z"),
        },
      },
    ],
  };
}

describe("buildProjectBuyerRoute", () => {
  it("projects recorded project data without inventing claim-bound evidence", () => {
    const route = buildProjectBuyerRoute(gawssInputs());

    expect(route.projectId).toBe(PROJECT_ID);
    expect(route.principal).toEqual({
      organisation: "Water Corporation",
      role: "principal",
      evidenceState: "recorded_unverified",
      buyerMeaning: "referral_and_package_confirmation_not_assumed_purchaser",
    });
    expect(route.projectLevelSources).toEqual([
      {
        label: "Project source",
        url: "https://example.test/project",
        date: "2026-07-01",
        claimBound: false,
      },
    ]);
    expect(route.packageHolders).toEqual([
      {
        organisation: "Georgiou Group",
        organisationType: "organisation",
        recordedRole: null,
        recordedStatus: "confirmed",
        packageScope: "Stage 1 works",
        evidenceState: "recorded_unverified",
        ingestionSources: ["seed_data"],
      },
      {
        organisation: "SRG Global / WBHO Infrastructure JV",
        organisationType: "joint_venture_recorded",
        recordedRole: null,
        recordedStatus: "confirmed",
        packageScope: "Recorded project package",
        evidenceState: "recorded_unverified",
        ingestionSources: ["seed_data"],
      },
    ]);
    expect(route.packageHolders).not.toContainEqual(
      expect.objectContaining({ evidenceState: "source_confirmed" })
    );
    expect(route.likelyEquipmentBuyer).toMatchObject({
      organisation: null,
      evidenceState: "inferred",
    });
    expect(route.likelyEquipmentBuyer.statement).toContain(
      "No particular buyer is proven"
    );
    expect(route.gaps).toEqual(
      expect.arrayContaining([
        "principal_claim_source_unbound",
        "contractor_claim_source_unbound",
        "employment_evidence_not_recorded",
        "project_link_evidence_not_recorded",
      ])
    );
  });

  it("recomputes contact policy, exposes only verified email and labels evidence limits", () => {
    const route = buildProjectBuyerRoute(gawssInputs());
    const verified = route.contacts.find(row => row.contactId === 1)!;
    const unsupported = route.contacts.find(row => row.contactId === 2)!;
    const llm = route.contacts.find(row => row.contactId === 3)!;

    expect(verified).toMatchObject({
      effectivelySendReady: true,
      effectiveTrustTier: "send_ready",
      eligibilityReasons: [],
      email: { value: "verified@example.test", state: "verified" },
      organisation: {
        recordedName: "Georgiou Group",
        evidenceState: "not_recorded",
      },
      lane: { value: "contractor", basis: "inferred" },
      source: {
        evidenceMeaning: "identity_discovery_not_employment_proof",
      },
      linkedin: {
        profileUrl: "https://www.linkedin.com/in/verified",
      },
      lastChecked: {
        at: new Date("2026-08-01T00:00:00.000Z"),
        basis: "contact_verified_at",
      },
      projectLink: {
        exactPersistedLink: true,
        externalEvidenceState: "not_recorded",
      },
    });
    expect(unsupported).toMatchObject({
      storedTrustTier: "send_ready",
      effectiveTrustTier: "named_unverified",
      effectivelySendReady: false,
      email: { value: null, state: "unverified" },
      lane: { value: "commercial", basis: "inferred" },
    });
    expect(llm).toMatchObject({
      storedTrustTier: "llm_inferred",
      effectiveTrustTier: "llm_inferred",
      effectivelySendReady: false,
      eligibilityReasons: ["llm_inferred"],
      email: { value: null, state: "unverified" },
    });
    expect(route.contacts.some(row => row.contactId === 4)).toBe(false);
  });

  it("marks LLM hypotheses as inferred and missing package scope explicitly", () => {
    const inputs = gawssInputs();
    inputs.project.contractors = [
      {
        name: "Possible Contractor",
        status: "predicted",
        detail: "[LLM hypothesis; unverified] possible package holder",
      },
      { name: "Recorded Contractor", status: "confirmed" },
    ];
    inputs.contractorLinks = [];

    const route = buildProjectBuyerRoute(inputs);

    expect(route.packageHolders).toEqual([
      expect.objectContaining({
        organisation: "Possible Contractor",
        evidenceState: "inferred",
      }),
      expect.objectContaining({
        organisation: "Recorded Contractor",
        packageScope: null,
        evidenceState: "recorded_unverified",
      }),
    ]);
    expect(route.gaps).toContain("package_scope_not_recorded");
    expect(route.unmappedScopes).toEqual([
      {
        scope: "Package scope for Recorded Contractor",
        evidenceState: "not_recorded",
        reason:
          "The organisation is linked to the project, but a package scope is not recorded.",
      },
    ]);
  });

  it("uses exact contractor-project links as recorded, not source-confirmed, fallback", () => {
    const inputs = gawssInputs();
    inputs.project.contractors = [];
    inputs.contractorLinks = [
      {
        contractorId: 22,
        canonicalName: "Exact Linked Contractor",
        aliases: null,
        role: "contractor",
        status: "confirmed",
        detail: "Civil works",
        confidence: 90,
        source: "seed_data",
        createdAt: new Date("2026-07-02T00:00:00.000Z"),
      },
    ];

    const route = buildProjectBuyerRoute(inputs);

    expect(route.packageHolders).toEqual([
      {
        organisation: "Exact Linked Contractor",
        organisationType: "organisation",
        recordedRole: "contractor",
        recordedStatus: "confirmed",
        packageScope: "Civil works",
        evidenceState: "recorded_unverified",
        ingestionSources: ["seed_data"],
      },
    ]);
  });

  it("does not promote supplier, consultant, rental or non-current links to package holders", () => {
    const inputs = gawssInputs();
    inputs.project.contractors = [];
    inputs.contractorLinks = [
      ...(["supplier", "consultant", "rental", "government", "unknown"] as const).map((role, index) => ({
        contractorId: 30 + index,
        canonicalName: `${role} organisation`,
        aliases: null,
        role,
        status: "confirmed",
        detail: null,
        confidence: 90,
        source: "seed_data",
        createdAt: new Date("2026-07-02T00:00:00.000Z"),
      })),
      {
        contractorId: 40,
        canonicalName: "Tendering Contractor",
        aliases: null,
        role: "contractor",
        status: "tendering",
        detail: null,
        confidence: 50,
        source: "seed_data",
        createdAt: new Date("2026-07-02T00:00:00.000Z"),
      },
    ];

    expect(buildProjectBuyerRoute(inputs).packageHolders).toEqual([]);
  });

  it("omits quarantined rows and deterministically deduplicates exact links", () => {
    const inputs = gawssInputs();
    const duplicate = inputs.contacts[1];
    inputs.contacts = [
      duplicate,
      {
        contact: { ...duplicate.contact },
        link: {
          relevance: "primary",
          createdAt: new Date("2026-07-20T00:00:00.000Z"),
        },
      },
      {
        contact: contact({
          id: 99,
          name: "Rejected Person",
          email: "rejected@example.test",
          rejectionReason: "wrong person",
        }),
        link: { relevance: "primary", createdAt: new Date() },
      },
    ];

    const route = buildProjectBuyerRoute(inputs);

    expect(route.contacts).toHaveLength(1);
    expect(route.contacts[0]).toMatchObject({
      contactId: 2,
      projectLink: { relevance: "primary" },
    });
    expect(route.contacts.some(row => row.contactId === 99)).toBe(false);
  });

  it("does not describe record creation as a verification check", () => {
    const inputs = gawssInputs();
    inputs.contacts = [{
      contact: contact({ id: 55, name: "Recorded Only" }),
      link: { relevance: "secondary", createdAt: new Date() },
    }];

    expect(buildProjectBuyerRoute(inputs).contacts[0].lastChecked).toEqual({
      at: null,
      basis: "not_recorded",
    });
  });

  it("drops non-HTTP links before the client can render them", () => {
    const inputs = gawssInputs();
    inputs.project.sources = [
      { label: "Unsafe project source", url: "javascript:alert(1)" },
      { label: "Safe project source", url: "https://example.test/project" },
    ];
    inputs.contacts[0].contact.linkedinProfileUrl = "data:text/html,unsafe";
    inputs.contacts[0].contact.linkedin = "https://example.test/not-linkedin";
    inputs.contacts[0].contact.linkedinSearchUrl = "javascript:alert(1)";
    inputs.contacts[0].contact.sourceUrl = "file:///etc/passwd";
    inputs.project.sources.push({
      label: "Credential-bearing source",
      url: "https://user:secret@example.test/project",
    });

    const route = buildProjectBuyerRoute(inputs);

    expect(route.projectLevelSources).toEqual([
      expect.objectContaining({
        label: "Safe project source",
        url: "https://example.test/project",
      }),
    ]);
    expect(route.contacts[0]).toMatchObject({
      linkedin: { profileUrl: null, searchUrl: null },
      source: { url: null },
    });
  });

  it("fails closed for generic principal values and absent contractor/contact data", () => {
    const inputs = gawssInputs();
    inputs.project.owner = "TBC";
    inputs.project.contractors = null;
    inputs.project.sources = [{ label: "missing URL" }];
    inputs.contacts = [];
    inputs.contractorLinks = [];

    const route = buildProjectBuyerRoute(inputs);

    expect(route.principal).toMatchObject({
      organisation: null,
      evidenceState: "not_recorded",
    });
    expect(route.projectLevelSources).toEqual([]);
    expect(route.packageHolders).toEqual([]);
    expect(route.contacts).toEqual([]);
    expect(route.gaps).toEqual([
      "buyer_lane_unmapped",
      "contractor_unmapped",
      "principal_not_recorded",
    ]);
  });

  it("does not promote contractor placeholders or punctuation into organisations", () => {
    for (const name of [
      "No contractor appointed",
      "No contractor selected yet",
      "Not yet appointed",
      "Contractor TBC",
      "To be selected",
      "---",
    ]) {
      const inputs = gawssInputs();
      inputs.project.contractors = [
        { name, status: "confirmed", detail: "Recorded placeholder" },
      ];
      inputs.contractorLinks = [];

      const route = buildProjectBuyerRoute(inputs);
      expect(route.packageHolders, name).toEqual([]);
      expect(route.gaps, name).toContain("contractor_unmapped");
    }
  });
});
