/**
 * Reset Password Page — Users reset their password using an admin-generated token
 */
import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Loader2, Lock, CheckCircle2, XCircle, ArrowRight } from "lucide-react";
import { toast } from "sonner";

function PasswordRequirement({ met, label }: { met: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {met ? (
        <CheckCircle2 className="w-3.5 h-3.5 text-teal shrink-0" />
      ) : (
        <XCircle className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      )}
      <span className={met ? "text-teal" : "text-muted-foreground"}>{label}</span>
    </div>
  );
}

export default function ResetPassword() {
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const token = params.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [success, setSuccess] = useState(false);

  const resetMutation = trpc.auth.resetPassword.useMutation({
    onSuccess: () => {
      setSuccess(true);
      toast.success("Password reset successfully!");
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasLength = password.length >= 8;
  const passwordsMatch = password === confirmPassword && password.length > 0;
  const allValid = hasUpper && hasLower && hasNumber && hasLength && passwordsMatch;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!allValid) {
      toast.error("Please meet all password requirements");
      return;
    }
    resetMutation.mutate({ resetToken: token, newPassword: password });
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center space-y-4 max-w-md">
          <XCircle className="w-12 h-12 text-destructive mx-auto" />
          <h2 className="text-xl font-bold text-navy">Invalid Reset Link</h2>
          <p className="text-muted-foreground text-sm">
            This password reset link is missing a token. Please check the link from your administrator.
          </p>
          <Button variant="outline" onClick={() => navigate("/login")}>
            Go to Login
          </Button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center space-y-4 max-w-md">
          <CheckCircle2 className="w-12 h-12 text-teal mx-auto" />
          <h2 className="text-xl font-bold text-navy">Password Reset Successfully</h2>
          <p className="text-muted-foreground text-sm">
            Your password has been updated. You can now sign in with your new password.
          </p>
          <Button className="bg-navy hover:bg-navy-light text-white" onClick={() => navigate("/login")}>
            Go to Login
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6 sm:p-12">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <div className="text-xl font-bold tracking-wider text-navy mb-1">ATLAS COPCO</div>
          <p className="text-muted-foreground text-sm">Market Intelligence Platform</p>
        </div>

        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-navy">Reset your password</h2>
          <p className="text-muted-foreground text-sm">
            Enter a new password for your account.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="password" className="text-sm font-medium">
              New password
            </Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="Enter new password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-10 pr-10 h-11"
                autoComplete="new-password"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm" className="text-sm font-medium">
              Confirm new password
            </Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="confirm"
                type={showConfirm ? "text" : "password"}
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="pl-10 pr-10 h-11"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg p-3 space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Password requirements</p>
            <PasswordRequirement met={hasLength} label="At least 8 characters" />
            <PasswordRequirement met={hasUpper} label="One uppercase letter" />
            <PasswordRequirement met={hasLower} label="One lowercase letter" />
            <PasswordRequirement met={hasNumber} label="One number" />
            <PasswordRequirement met={passwordsMatch} label="Passwords match" />
          </div>

          <Button
            type="submit"
            disabled={!allValid || resetMutation.isPending}
            className="w-full h-11 bg-navy hover:bg-navy-light text-white font-semibold gap-2"
          >
            {resetMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                Reset Password <ArrowRight className="w-4 h-4" />
              </>
            )}
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          Remember your password?{" "}
          <button onClick={() => navigate("/login")} className="text-navy font-medium hover:underline">
            Sign in
          </button>
        </p>
      </div>
    </div>
  );
}
