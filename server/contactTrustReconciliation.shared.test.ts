import { describe, expect, it } from "vitest";
import {
  CONTACT_TRUST_MANIFEST_VERSION,
  buildContactDuplicateIndex,
  buildManifestSummary,
  classifyContactTrustDisposition,
  deriveContactTrustEvidence,
  historicGeneratedEmail,
  sealContactTrustManifest,
  selectApprovedManifestRows,
  verifySealedContactTrustManifest,
  type ContactTrustContactSnapshot,
  type ContactTrustContext,
  type ContactTrustHunterLog,
  type ContactTrustManifestDraft,
} from "./contactTrustReconciliation.shared";

function contact(overrides: Partial<ContactTrustContactSnapshot> = {}): ContactTrustContactSnapshot {
  return {
    id: 1,
    name: "Jane Smith",
    title: "Procurement Manager",
    company: "Example Mining Group",
    legacyProjectText: "Example Mine Expansion",
    email: null,
    emailVerified: false,
    contactTrustTier: "named_unverified",
    enrichmentSource: "web_search",
    verificationStatus: "unverified",
    verifiedByUserId: null,
    verifiedAt: null,
    rejectionReason: null,
    linkedin: null,
    linkedinProfileUrl: null,
    verifiedLinkedinUrl: null,
    source: "scraper",
    crmOrphan: false,
    createdAt: "2026-07-21T00:00:00.000Z",
    ...overrides,
  };
}

function context(overrides: Partial<ContactTrustContext> = {}): ContactTrustContext {
  const baseContact = overrides.contact || contact();
  return {
    contact: baseContact,
    linkedProjectIds: [101],
    exactProjectMatches: [],
    evidence: deriveContactTrustEvidence({
      contact: baseContact,
      hunterLogs: [],
      apolloLogs: [],
      validationActions: [],
    }),
    duplicates: {
      strongDuplicateGroupId: null,
      strongDuplicateContactIds: [],
      strongDuplicateKeys: [],
      recommendedSurvivorContactId: null,
      nameEmployerCandidateContactIds: [],
    },
    ...overrides,
  };
}

function hunter(overrides: Partial<ContactTrustHunterLog> = {}): ContactTrustHunterLog {
  return {
    id: 1,
    contactId: 1,
    hunterStatus: "valid",
    hunterConfidence: 90,
    emailFound: "jane.smith@examplemining.com.au",
    queryInput: null,
    contactUpdated: true,
    tierPromoted: true,
    createdAt: "2026-07-21T00:00:00.000Z",
    ...overrides,
  };
}

describe("historicGeneratedEmail", () => {
  it("reproduces the exact former first.last company heuristic", () => {
    expect(historicGeneratedEmail("Jane Smith", "Example Mining Group"))
      .toBe("jane.smith@examplemining.com.au");
  });

  it("uses the first and final name components only", () => {
    expect(historicGeneratedEmail("Mary Jane Watson", "Rio Tinto Limited"))
      .toBe("mary.watson@riotinto.com.au");
  });

  it("does not generate alternate common mailbox patterns", () => {
    expect(historicGeneratedEmail("Jane Smith", "Example Mining"))
      .not.toBe("j.smith@examplemining.com.au");
  });

  it("returns null for insufficient identity input", () => {
    expect(historicGeneratedEmail("Jane", "Example Mining")).toBeNull();
    expect(historicGeneratedEmail("Jane Smith", "")).toBeNull();
  });
});

describe("evidence precedence", () => {
  it("recognises a valid Hunter result for the current mailbox", () => {
    const row = contact({
      email: "jane.smith@examplemining.com.au",
      contactTrustTier: "named_unverified",
    });
    const evidence = deriveContactTrustEvidence({
      contact: row,
      hunterLogs: [hunter()],
      apolloLogs: [],
      validationActions: [],
    });
    expect(evidence.hunterValidForCurrentEmail).toBe(true);
    expect(evidence.strongEmailEvidence).toBe(true);
  });

  it("does not treat accept-all as mailbox verification", () => {
    const row = contact({
      email: "jane.smith@examplemining.com.au",
      contactTrustTier: "send_ready",
      emailVerified: true,
    });
    const evidence = deriveContactTrustEvidence({
      contact: row,
      hunterLogs: [hunter({ hunterStatus: "accept_all", hunterConfidence: 95 })],
      apolloLogs: [],
      validationActions: [],
    });
    expect(evidence.hunterAcceptAllOnly).toBe(true);
    expect(evidence.hunterValidForCurrentEmail).toBe(false);
  });

  it("recognises later valid Hunter evidence after accept-all", () => {
    const row = contact({
      email: "jane.smith@examplemining.com.au",
      contactTrustTier: "send_ready",
      emailVerified: true,
    });
    const evidence = deriveContactTrustEvidence({
      contact: row,
      hunterLogs: [
        hunter({ id: 1, hunterStatus: "accept_all", createdAt: "2026-07-20T00:00:00.000Z" }),
        hunter({ id: 2, hunterStatus: "valid", createdAt: "2026-07-21T00:00:00.000Z" }),
      ],
      apolloLogs: [],
      validationActions: [],
    });
    expect(evidence.laterHunterValidAfterAcceptAll).toBe(true);
    expect(evidence.hunterAcceptAllOnly).toBe(false);
  });
});

describe("contact disposition", () => {
  it("clears an exact historic generated email only when no later evidence exists", () => {
    const row = contact({
      email: "jane.smith@examplemining.com.au",
      emailVerified: false,
      contactTrustTier: "send_ready",
      enrichmentSource: "web_search",
    });
    const result = classifyContactTrustDisposition(context({
      contact: row,
      evidence: deriveContactTrustEvidence({ contact: row, hunterLogs: [], apolloLogs: [], validationActions: [] }),
    }));
    expect(result.disposition).toBe("safe_clear_generated_email");
    expect(result.expectedAfter.email).toBeNull();
    expect(result.expectedAfter.contactTrustTier).toBe("named_unverified");
  });

  it("retains a provider-verified address even when its format matches the historic pattern", () => {
    const row = contact({
      email: "jane.smith@examplemining.com.au",
      emailVerified: true,
      contactTrustTier: "send_ready",
      enrichmentSource: "apollo",
      verificationStatus: "verified",
    });
    const result = classifyContactTrustDisposition(context({
      contact: row,
      evidence: deriveContactTrustEvidence({ contact: row, hunterLogs: [], apolloLogs: [], validationActions: [] }),
    }));
    expect(result.disposition).toBe("safe_keep");
  });

  it("demotes an accept-all-only send-ready contact", () => {
    const row = contact({
      email: "different.address@example.com",
      emailVerified: true,
      contactTrustTier: "send_ready",
    });
    const result = classifyContactTrustDisposition(context({
      contact: row,
      evidence: deriveContactTrustEvidence({
        contact: row,
        hunterLogs: [hunter({
          hunterStatus: "accept_all",
          hunterConfidence: 90,
          emailFound: "different.address@example.com",
        })],
        apolloLogs: [],
        validationActions: [],
      }),
    }));
    expect(result.disposition).toBe("safe_demote");
  });

  it("promotes a named contact only when valid mailbox evidence exists", () => {
    const row = contact({
      email: "different.address@example.com",
      contactTrustTier: "named_unverified",
    });
    const result = classifyContactTrustDisposition(context({
      contact: row,
      evidence: deriveContactTrustEvidence({
        contact: row,
        hunterLogs: [hunter({ emailFound: "different.address@example.com" })],
        apolloLogs: [],
        validationActions: [],
      }),
    }));
    expect(result.disposition).toBe("safe_promote");
    expect(result.expectedAfter.emailVerified).toBe(true);
  });

  it("demotes send-ready without email", () => {
    const row = contact({ contactTrustTier: "send_ready", email: null, emailVerified: false });
    const result = classifyContactTrustDisposition(context({ contact: row }));
    expect(result.disposition).toBe("safe_demote");
  });

  it("does not automatically promote an LLM identity on provider evidence alone", () => {
    const row = contact({
      email: "different.address@example.com",
      contactTrustTier: "llm_inferred",
    });
    const result = classifyContactTrustDisposition(context({
      contact: row,
      evidence: deriveContactTrustEvidence({
        contact: row,
        hunterLogs: [hunter({ emailFound: "different.address@example.com" })],
        apolloLogs: [],
        validationActions: [],
      }),
    }));
    expect(result.disposition).toBe("manual_review");
  });

  it("links an orphan only when one exact project match exists", () => {
    const row = contact({ legacyProjectText: "Exact Project" });
    const result = classifyContactTrustDisposition(context({
      contact: row,
      linkedProjectIds: [],
      exactProjectMatches: [{ id: 88, name: "Exact Project", lifecycleStatus: "active", suppressed: false, mergedIntoId: null }],
    }));
    expect(result.disposition).toBe("safe_link_to_project");
    expect(result.expectedAfter.linkProjectId).toBe(88);
  });

  it("sends ambiguous project matches to review", () => {
    const row = contact({ legacyProjectText: "Duplicate Project" });
    const result = classifyContactTrustDisposition(context({
      contact: row,
      linkedProjectIds: [],
      exactProjectMatches: [
        { id: 88, name: "Duplicate Project", lifecycleStatus: "active", suppressed: false, mergedIntoId: null },
        { id: 89, name: "Duplicate Project", lifecycleStatus: "active", suppressed: false, mergedIntoId: null },
      ],
    }));
    expect(result.disposition).toBe("manual_review");
  });

  it("never automatically changes a duplicate person candidate", () => {
    const result = classifyContactTrustDisposition(context({
      duplicates: {
        strongDuplicateGroupId: "strong:test",
        strongDuplicateContactIds: [1, 2],
        strongDuplicateKeys: ["verified_email:test@example.com"],
        recommendedSurvivorContactId: 1,
        nameEmployerCandidateContactIds: [1, 2],
      },
    }));
    expect(result.disposition).toBe("manual_review");
  });
});

describe("duplicate connected components", () => {
  it("uses strong identity keys and keeps name/employer as review-only evidence", () => {
    const index = buildContactDuplicateIndex([
      {
        contactId: 1,
        normalisedName: "jane smith",
        normalisedEmployer: "example mining",
        verifiedEmail: "jane@example.com",
        linkedinUrl: null,
        apolloPersonIds: [],
        qualityScore: 10,
      },
      {
        contactId: 2,
        normalisedName: "jane smith",
        normalisedEmployer: "example mining",
        verifiedEmail: "jane@example.com",
        linkedinUrl: null,
        apolloPersonIds: [],
        qualityScore: 20,
      },
      {
        contactId: 3,
        normalisedName: "jane smith",
        normalisedEmployer: "other employer",
        verifiedEmail: null,
        linkedinUrl: null,
        apolloPersonIds: [],
        qualityScore: 5,
      },
    ]);
    expect(index.get(1)?.strongDuplicateContactIds).toEqual([1, 2]);
    expect(index.get(1)?.recommendedSurvivorContactId).toBe(2);
    expect(index.get(3)?.strongDuplicateContactIds).toEqual([]);
  });
});

describe("manifest guardrails", () => {
  function draftWithRow() {
    const row = classifyContactTrustDisposition(context({
      contact: contact({ contactTrustTier: "send_ready", email: null }),
    }));
    const rows = [{ ...row, approved: true }];
    return {
      schemaVersion: CONTACT_TRUST_MANIFEST_VERSION,
      generatedAt: "2026-07-21T00:00:00.000Z",
      databaseIdentity: "database-identity",
      databaseFingerprint: "database-hash",
      sealed: false as const,
      summary: buildManifestSummary(rows),
      rows,
    } satisfies ContactTrustManifestDraft;
  }

  it("seals an operator-approved safe manifest and verifies its hash", () => {
    const sealed = sealContactTrustManifest(draftWithRow(), "2026-07-21T01:00:00.000Z");
    expect(sealed.manifestHash).toHaveLength(64);
    expect(verifySealedContactTrustManifest(sealed)).toBe(true);
  });

  it("rejects edits to a generated row other than approved", () => {
    const draft = draftWithRow();
    draft.rows[0].expectedAfter.email = "tampered@example.com";
    expect(() => sealContactTrustManifest(draft)).toThrow(/changed outside the approved flag/);
  });

  it("detects a tampered sealed manifest", () => {
    const sealed = sealContactTrustManifest(draftWithRow());
    const tampered = { ...sealed, databaseFingerprint: "other" };
    expect(verifySealedContactTrustManifest(tampered)).toBe(false);
  });

  it("supports contact/project/disposition canary filters and a hard maximum", () => {
    const base = draftWithRow();
    const secondRow = classifyContactTrustDisposition(context({
      contact: contact({ id: 2, contactTrustTier: "send_ready", email: null }),
      linkedProjectIds: [222],
    }));
    const draft: ContactTrustManifestDraft = {
      ...base,
      rows: [base.rows[0], { ...secondRow, approved: true }],
      summary: buildManifestSummary([base.rows[0], { ...secondRow, approved: true }]),
    };
    const sealed = sealContactTrustManifest(draft);
    const selected = selectApprovedManifestRows(sealed, { projectIds: [222], maxApply: 1 });
    expect(selected.map(row => row.contactId)).toEqual([2]);
  });
});
