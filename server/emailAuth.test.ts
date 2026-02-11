/**
 * Tests for email/password authentication service
 */
import { describe, it, expect } from "vitest";
import { validatePassword, hashPassword, verifyPassword } from "./emailAuth";

describe("Email Auth — Password Validation", () => {
  it("rejects passwords shorter than 8 characters", () => {
    const result = validatePassword("Ab1cdef");
    expect(result.valid).toBe(false);
    expect(result.message).toContain("at least 8 characters");
  });

  it("rejects passwords longer than 128 characters", () => {
    const result = validatePassword("A".repeat(129));
    expect(result.valid).toBe(false);
    expect(result.message).toContain("less than 128");
  });

  it("rejects passwords without uppercase letter", () => {
    const result = validatePassword("abcdefg1");
    expect(result.valid).toBe(false);
    expect(result.message).toContain("uppercase");
  });

  it("rejects passwords without lowercase letter", () => {
    const result = validatePassword("ABCDEFG1");
    expect(result.valid).toBe(false);
    expect(result.message).toContain("lowercase");
  });

  it("rejects passwords without a number", () => {
    const result = validatePassword("Abcdefgh");
    expect(result.valid).toBe(false);
    expect(result.message).toContain("number");
  });

  it("accepts valid passwords", () => {
    expect(validatePassword("Abcdefg1").valid).toBe(true);
    expect(validatePassword("StrongPass123").valid).toBe(true);
    expect(validatePassword("MyP@ssw0rd!").valid).toBe(true);
  });
});

describe("Email Auth — Password Hashing", () => {
  it("hashes and verifies a password correctly", async () => {
    const password = "SecurePass123";
    const hash = await hashPassword(password);

    expect(hash).not.toBe(password);
    expect(hash.length).toBeGreaterThan(0);

    const isValid = await verifyPassword(password, hash);
    expect(isValid).toBe(true);
  });

  it("rejects wrong password", async () => {
    const hash = await hashPassword("CorrectPass1");
    const isValid = await verifyPassword("WrongPass1", hash);
    expect(isValid).toBe(false);
  });

  it("produces different hashes for the same password (salt)", async () => {
    const password = "SamePass123";
    const hash1 = await hashPassword(password);
    const hash2 = await hashPassword(password);
    expect(hash1).not.toBe(hash2); // bcrypt uses random salt
  });
});
