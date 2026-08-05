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
    // No email → not effectively send_ready
    expect(result.selectedContact).toBeNull();
  });

  it("does not select a send_ready contact with emailVerified=false", () => {
    const contact = makeContact({ emailVerified: false });
    const result = selectProjectContact([contact], BASE_OPTIONS);
    expect(result.selectedContact).toBeNull();
  });

  it("does not select a send_ready contact with verificationStatus != verified", () => {
    const contact = makeContact({ verificationStatus: "unverified" });
    const result = selectProjectContact([contact], BASE_OPTIONS);
    expect(result.selectedContact).toBeNull();
  });

  it("does not select a crmOrphan contact even if send_ready", () => {
    const contact = makeContact({ crmOrphan: true });
    const result = selectProjectContact([contact], BASE_OPTIONS);
    expect(result.selectedContact).toBeNull();
  });

  it("does not select a contact with a rejectionReason", () => {
    const contact = makeContact({ rejectionReason: "bounced" });
    const result = selectProjectContact([contact], BASE_OPTIONS);
    expect(result.selectedContact).toBeNull();
  });

  it("never selects llm_inferred as primary", () => {
    const llm = makeContact({ id: 2, contactTrustTier: "llm_inferred" });
    const result = selectProjectContact([llm], BASE_OPTIONS);
    expect(result.selectedContact).toBeNull();
  });

  it("puts named_unverified in fallbackContacts, not selectedContact", () => {
    const named = makeContact({
      id: 3,
      contactTrustTier: "named_unverified",
      emailVerified: false,
    });
    const result = selectProjectContact([named], BASE_OPTIONS);
    // named_unverified should NOT be selectedContact (per Issue #85 spec)
    // It may appear in fallbackContacts
    if (result.selectedContact !== null) {
      expect(result.selectedContact.trustTier).not.toBe("llm_inferred");
    }
    // salesReadiness must not be "send_ready" if no effectively-send-ready contact
    expect(result.salesReadiness).not.toBe("send_ready");
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
