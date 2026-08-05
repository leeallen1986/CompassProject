/**
 * contactSelector.issue85.test.ts
 *
 * Tests for the Issue #85 changes to selectProjectContact:
 * - ContactInput extended with emailVerified and crmOrphan
 * - send_ready filter uses isEffectivelySendReady policy (not just contactTrustTier)
 * - named_unverified contacts remain as fallback but never as primary
 * - llm_inferred contacts never shown as primary
 * - crmOrphan contacts excluded from all selection paths
 */
import { describe, it, expect } from "vitest";
import { selectProjectContact, type ContactInput } from "./contactSelector";

// ── Helpers ───────────────────────────────────────────────────────────────────
const BASE_OPTIONS = {
  projectName: "Pilbara Iron Ore Expansion",
  projectOwner: "FMG",
  projectState: "WA",
};

function makeContact(overrides: Partial<ContactInput> = {}): ContactInput {
  return {
    id: 1,
    name: "Bob Jones",
    title: "Site Manager",
    company: "BuildCo",
    project: "Pilbara Iron Ore Expansion",
    priority: "hot",
    roleBucket: "manager",
    email: "bob@buildco.com",
    enrichmentSource: "linkedin",
    contactTrustTier: "send_ready",
    emailVerified: true,
    verificationStatus: "verified",
    rejectionReason: null,
    crmOrphan: false,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("selectProjectContact — Issue #85 send_ready policy", () => {
  it("returns null when no contacts are provided", () => {
    const result = selectProjectContact([], BASE_OPTIONS);
    expect(result.selectedContact).toBeNull();
    expect(result.salesReadiness).toBe("no_contact");
  });

  it("selects a fully eligible send_ready contact", () => {
    const contact = makeContact();
    const result = selectProjectContact([contact], BASE_OPTIONS);
    expect(result.selectedContact).not.toBeNull();
    expect(result.selectedContact?.id).toBe(1);
    expect(result.salesReadiness).toBe("send_ready");
  });

  it("does not select a send_ready contact with empty email", () => {
    const contact = makeContact({ email: null });
    const result = selectProjectContact([contact], BASE_OPTIONS);
    expect(result.selectedContact).toBeNull();
    expect(result.salesReadiness).toBe("no_contact");
  });

  it("does not select a send_ready contact with a whitespace-only email", () => {
    const contact = makeContact({ email: "   \t" });
    const result = selectProjectContact([contact], BASE_OPTIONS);
    expect(result.selectedContact).toBeNull();
    expect(result.salesReadiness).toBe("no_contact");
  });

  it.each(
    [
      ["emailVerified=false", { emailVerified: false }],
      ["emailVerified=null", { emailVerified: null }],
      ["emailVerified=undefined", { emailVerified: undefined }],
      ["verificationStatus unverified", { verificationStatus: "unverified" }],
      ["verificationStatus=null", { verificationStatus: null }],
      ["verificationStatus=undefined", { verificationStatus: undefined }],
    ] satisfies Array<[string, Partial<ContactInput>]>,
  )(
    "fails closed when %s",
    (_description, overrides) => {
      const result = selectProjectContact([makeContact(overrides)], BASE_OPTIONS);
      expect(result.selectedContact).toBeNull();
      expect(result.salesReadiness).toBe("no_contact");
    },
  );

  it("does not select a crmOrphan contact even if send_ready", () => {
    const contact = makeContact({ crmOrphan: true });
    const result = selectProjectContact([contact], BASE_OPTIONS);
    expect(result.selectedContact).toBeNull();
    expect(result.fallbackContacts).toEqual([]);
    expect(result.salesReadiness).toBe("no_contact");
  });

  it.each([null, undefined])(
    "fails closed when crmOrphan is %s",
    crmOrphan => {
      const result = selectProjectContact(
        [makeContact({ crmOrphan })],
        BASE_OPTIONS,
      );
      expect(result.selectedContact).toBeNull();
      expect(result.fallbackContacts).toEqual([]);
    },
  );

  it.each(["bounced", ""])(
    "does not select a contact with rejectionReason=%j",
    rejectionReason => {
      const result = selectProjectContact(
        [makeContact({ rejectionReason })],
        BASE_OPTIONS,
      );
      expect(result.selectedContact).toBeNull();
      expect(result.fallbackContacts).toEqual([]);
      expect(result.salesReadiness).toBe("no_contact");
    },
  );

  it("excludes a crmOrphan named_unverified contact from fallbacks", () => {
    const contact = makeContact({
      contactTrustTier: "named_unverified",
      emailVerified: false,
      crmOrphan: true,
    });
    const result = selectProjectContact([contact], BASE_OPTIONS);
    expect(result.selectedContact).toBeNull();
    expect(result.fallbackContacts).toEqual([]);
    expect(result.salesReadiness).toBe("no_contact");
  });

  it("excludes a named_unverified contact with an empty rejection reason from fallbacks", () => {
    const contact = makeContact({
      contactTrustTier: "named_unverified",
      emailVerified: false,
      rejectionReason: "",
    });
    const result = selectProjectContact([contact], BASE_OPTIONS);
    expect(result.selectedContact).toBeNull();
    expect(result.fallbackContacts).toEqual([]);
    expect(result.salesReadiness).toBe("no_contact");
  });

  it("never selects llm_inferred as primary", () => {
    const llm = makeContact({ id: 2, contactTrustTier: "llm_inferred" });
    const result = selectProjectContact([llm], BASE_OPTIONS);
    expect(result.selectedContact).toBeNull();
  });

  it("rejects an inconsistent send_ready row whose source is LLM", () => {
    const result = selectProjectContact([
      makeContact({ enrichmentSource: "llm", contactTrustTier: "send_ready" }),
    ], BASE_OPTIONS);
    expect(result.selectedContact).toBeNull();
    expect(result.salesReadiness).toBe("no_contact");
  });

  it("puts named_unverified in fallbackContacts, not selectedContact", () => {
    const named = makeContact({
      id: 3,
      contactTrustTier: "named_unverified",
      emailVerified: false,
    });
    const result = selectProjectContact([named], BASE_OPTIONS);
    expect(result.selectedContact).toBeNull();
    expect(result.salesReadiness).toBe("needs_verification");
    expect(result.fallbackContacts).toEqual([
      expect.objectContaining({ id: 3, trustTier: "named_unverified" }),
    ]);
  });

  it("prefers send_ready over named_unverified when both present", () => {
    const sendReady = makeContact({ id: 1, contactTrustTier: "send_ready" });
    const named = makeContact({
      id: 2,
      contactTrustTier: "named_unverified",
      emailVerified: false,
    });
    const result = selectProjectContact([named, sendReady], BASE_OPTIONS);
    expect(result.selectedContact?.id).toBe(1);
    expect(result.salesReadiness).toBe("send_ready");
  });

  it("does not discard an exact-linked contact because legacy project text is stale", () => {
    const contact = makeContact({
      project: "Unrelated legacy project text",
      company: "Unrelated contractor name",
    });
    const result = selectProjectContact([contact], {
      ...BASE_OPTIONS,
      contactsAreExactProjectLinks: true,
    });
    expect(result.selectedContact?.id).toBe(contact.id);
    expect(result.salesReadiness).toBe("send_ready");
  });

  it("ContactInput type accepts emailVerified and crmOrphan fields", () => {
    // Compile-time check: these fields must exist on ContactInput
    const contact: ContactInput = makeContact({
      emailVerified: true,
      crmOrphan: false,
    });
    expect(contact.emailVerified).toBe(true);
    expect(contact.crmOrphan).toBe(false);
  });
});
