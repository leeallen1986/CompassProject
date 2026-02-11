/**
 * Email/Password Authentication Service
 *
 * Provides a custom auth flow for distributors and external users alongside
 * the existing Manus OAuth for internal team members.
 *
 * Features:
 * - Admin-managed invitations (admin creates account, user sets password)
 * - bcrypt password hashing (cost factor 12)
 * - JWT session tokens (same format as OAuth sessions for compatibility)
 * - Concurrent session support (multiple users on same credentials)
 * - Password reset via admin-generated reset tokens
 */
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { users, type User } from "../drizzle/schema";
import { sdk } from "./_core/sdk";
import { ENV } from "./_core/env";

const BCRYPT_ROUNDS = 12;
const INVITE_TOKEN_BYTES = 32;
const INVITE_EXPIRY_HOURS = 72; // 3 days

// ── Password Helpers ──

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function validatePassword(password: string): { valid: boolean; message: string } {
  if (password.length < 8) return { valid: false, message: "Password must be at least 8 characters" };
  if (password.length > 128) return { valid: false, message: "Password must be less than 128 characters" };
  if (!/[A-Z]/.test(password)) return { valid: false, message: "Password must contain at least one uppercase letter" };
  if (!/[a-z]/.test(password)) return { valid: false, message: "Password must contain at least one lowercase letter" };
  if (!/[0-9]/.test(password)) return { valid: false, message: "Password must contain at least one number" };
  return { valid: true, message: "Password meets requirements" };
}

// ── Invite Token Helpers ──

function generateInviteToken(): string {
  return crypto.randomBytes(INVITE_TOKEN_BYTES).toString("hex");
}

function getInviteExpiry(): Date {
  return new Date(Date.now() + INVITE_EXPIRY_HOURS * 60 * 60 * 1000);
}

// ── Core Auth Functions ──

/**
 * Admin creates an invitation for a new email user.
 * Generates a unique openId (email-prefixed) and invite token.
 */
export async function createInvite(params: {
  email: string;
  name: string;
  role: "user" | "admin" | "distributor";
  invitedByUserId: number;
}): Promise<{ inviteToken: string; email: string; expiresAt: Date }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Check if email already exists
  const existing = await db.select().from(users)
    .where(eq(users.email, params.email)).limit(1);
  if (existing.length > 0) {
    throw new Error(`A user with email ${params.email} already exists`);
  }

  const inviteToken = generateInviteToken();
  const expiresAt = getInviteExpiry();
  // Generate a unique openId for email-based users (prefixed to avoid collision with OAuth openIds)
  const openId = `email_${crypto.randomBytes(16).toString("hex")}`;

  await db.insert(users).values({
    openId,
    name: params.name,
    email: params.email,
    authMethod: "email",
    role: params.role,
    invitedBy: params.invitedByUserId,
    inviteToken,
    inviteExpiresAt: expiresAt,
    lastSignedIn: new Date(),
  });

  return { inviteToken, email: params.email, expiresAt };
}

/**
 * User completes registration by setting their password using the invite token.
 */
export async function completeRegistration(params: {
  inviteToken: string;
  password: string;
}): Promise<{ user: User; sessionToken: string }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Validate password
  const validation = validatePassword(params.password);
  if (!validation.valid) throw new Error(validation.message);

  // Find user by invite token
  const result = await db.select().from(users)
    .where(eq(users.inviteToken, params.inviteToken)).limit(1);

  if (result.length === 0) {
    throw new Error("Invalid or expired invitation token");
  }

  const user = result[0];

  // Check expiry
  if (user.inviteExpiresAt && new Date() > user.inviteExpiresAt) {
    throw new Error("Invitation has expired. Please ask your admin to send a new one.");
  }

  // Hash password and update user
  const passwordHash = await hashPassword(params.password);

  await db.update(users)
    .set({
      passwordHash,
      inviteToken: null,
      inviteExpiresAt: null,
      lastSignedIn: new Date(),
    })
    .where(eq(users.id, user.id));

  // Create session token
  const sessionToken = await sdk.createSessionToken(user.openId, {
    name: user.name || "",
    expiresInMs: 1000 * 60 * 60 * 24 * 365, // 1 year
  });

  // Fetch updated user
  const updatedResult = await db.select().from(users)
    .where(eq(users.id, user.id)).limit(1);

  return { user: updatedResult[0], sessionToken };
}

/**
 * Email/password login. Returns a session token on success.
 * Supports concurrent sessions — each login creates an independent JWT.
 */
export async function loginWithEmail(params: {
  email: string;
  password: string;
}): Promise<{ user: User; sessionToken: string }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Find user by email
  const result = await db.select().from(users)
    .where(eq(users.email, params.email)).limit(1);

  if (result.length === 0) {
    throw new Error("Invalid email or password");
  }

  const user = result[0];

  // Must be an email auth user with a password set
  if (user.authMethod !== "email") {
    throw new Error("This account uses Manus login. Please use the Manus login button instead.");
  }

  if (!user.passwordHash) {
    throw new Error("Account setup incomplete. Please check your email for the invitation link.");
  }

  // Verify password
  const valid = await verifyPassword(params.password, user.passwordHash);
  if (!valid) {
    throw new Error("Invalid email or password");
  }

  // Update last signed in
  await db.update(users)
    .set({ lastSignedIn: new Date() })
    .where(eq(users.id, user.id));

  // Create session token — each login gets its own JWT for concurrent session support
  const sessionToken = await sdk.createSessionToken(user.openId, {
    name: user.name || "",
    expiresInMs: 1000 * 60 * 60 * 24 * 365,
  });

  return { user, sessionToken };
}

/**
 * Admin generates a password reset token for a user.
 */
export async function generatePasswordReset(userId: number): Promise<{ resetToken: string; expiresAt: Date }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.select().from(users)
    .where(eq(users.id, userId)).limit(1);

  if (result.length === 0) throw new Error("User not found");
  if (result[0].authMethod !== "email") throw new Error("Cannot reset password for OAuth users");

  const resetToken = generateInviteToken();
  const expiresAt = getInviteExpiry();

  await db.update(users)
    .set({
      inviteToken: resetToken,
      inviteExpiresAt: expiresAt,
    })
    .where(eq(users.id, userId));

  return { resetToken, expiresAt };
}

/**
 * User resets their password using a reset token.
 */
export async function resetPassword(params: {
  resetToken: string;
  newPassword: string;
}): Promise<{ success: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const validation = validatePassword(params.newPassword);
  if (!validation.valid) throw new Error(validation.message);

  const result = await db.select().from(users)
    .where(eq(users.inviteToken, params.resetToken)).limit(1);

  if (result.length === 0) throw new Error("Invalid or expired reset token");

  const user = result[0];
  if (user.inviteExpiresAt && new Date() > user.inviteExpiresAt) {
    throw new Error("Reset token has expired. Please ask your admin to generate a new one.");
  }

  const passwordHash = await hashPassword(params.newPassword);

  await db.update(users)
    .set({
      passwordHash,
      inviteToken: null,
      inviteExpiresAt: null,
    })
    .where(eq(users.id, user.id));

  return { success: true };
}

/**
 * List all email-auth users (for admin management).
 */
export async function getEmailUsers(): Promise<User[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(users)
    .where(eq(users.authMethod, "email"));
}

/**
 * Delete an email-auth user (admin only).
 */
export async function deleteEmailUser(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.select().from(users)
    .where(eq(users.id, userId)).limit(1);

  if (result.length === 0) throw new Error("User not found");
  if (result[0].authMethod !== "email") throw new Error("Cannot delete OAuth users from here");

  await db.delete(users).where(eq(users.id, userId));
}
