import { describe, it, expect } from "vitest";
import { validateResendKey, sendEmail } from "./emailSender";

describe("emailSender", () => {
  it("should validate Resend API key", async () => {
    const valid = await validateResendKey();
    expect(valid).toBe(true);
  }, 15000);

  it("should export sendEmail function", () => {
    expect(typeof sendEmail).toBe("function");
  });

  it("should export validateResendKey function", () => {
    expect(typeof validateResendKey).toBe("function");
  });
});
