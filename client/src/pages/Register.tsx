/**
 * Register Page — Users complete their invitation by setting a password
 */
import { useState, useEffect } from "react";
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

export default function Register() {
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const token = params.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const { data: tokenInfo, isLoading: validating } = trpc.auth.validateInviteToken.useQuery(
    { token },
    { enabled: !!token }
  );

  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: () => {
      toast.success("Account created successfully! Redirecting...");
      setTimeout(() => navigate("/"), 1000);
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
    registerMutation.mutate({ inviteToken: token, password });
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center space-y-4 max-w-md">
          <XCircle className="w-12 h-12 text-destructive mx-auto" />
          <h2 className="text-xl font-bold text-navy">Invalid Registration Link</h2>
          <p className="text-muted-foreground text-sm">
            This registration link is missing a token. Please check the link from your invitation email.
          </p>
          <Button variant="outline" onClick={() => navigate("/login")}>
            Go to Login
          </Button>
        </div>
      </div>
    );
  }

  if (validating) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-navy" />
      </div>
    );
  }

  if (tokenInfo && !tokenInfo.valid) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center space-y-4 max-w-md">
          <XCircle className="w-12 h-12 text-destructive mx-auto" />
          <h2 className="text-xl font-bold text-navy">Invitation Expired or Invalid</h2>
          <p className="text-muted-foreground text-sm">
            This invitation link has expired or has already been used. Please contact your administrator for a new invitation.
          </p>
          <Button variant="outline" onClick={() => navigate("/login")}>
            Go to Login
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left panel — branding */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-navy">
        <div className="absolute inset-0 bg-gradient-to-br from-navy via-navy-light/80 to-navy" />
        <div className="relative z-10 flex flex-col justify-between p-12 text-white">
          <div>
            <div className="text-2xl font-bold tracking-wider text-gold">ATLAS COPCO</div>
            <p className="text-slate-400 text-sm mt-1">Market Intelligence Platform</p>
          </div>
          <div className="space-y-6">
            <h1 className="text-4xl font-bold leading-tight">
              Welcome to the<br />
              <span className="text-gold">intelligence platform</span>
            </h1>
            <p className="text-slate-300 text-base max-w-md leading-relaxed">
              Set up your password to access curated project data, contact intelligence, and market insights.
            </p>
          </div>
          <p className="text-slate-500 text-xs">
            &copy; {new Date().getFullYear()} Atlas Copco. All rights reserved.
          </p>
        </div>
      </div>

      {/* Right panel — registration form */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md space-y-8">
          <div className="lg:hidden text-center mb-8">
            <div className="text-xl font-bold tracking-wider text-navy">ATLAS COPCO</div>
            <p className="text-muted-foreground text-sm">Market Intelligence Platform</p>
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-navy">Complete your registration</h2>
            {tokenInfo?.email && (
              <p className="text-muted-foreground text-sm">
                Setting up account for <strong className="text-foreground">{tokenInfo.email}</strong>
              </p>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium">
                Create password
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Create a strong password"
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
                Confirm password
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="confirm"
                  type={showConfirm ? "text" : "password"}
                  placeholder="Confirm your password"
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

            {/* Password requirements */}
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
              disabled={!allValid || registerMutation.isPending}
              className="w-full h-11 bg-navy hover:bg-navy-light text-white font-semibold gap-2"
            >
              {registerMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  Create Account <ArrowRight className="w-4 h-4" />
                </>
              )}
            </Button>
          </form>

          <p className="text-center text-xs text-muted-foreground">
            Already have an account?{" "}
            <button onClick={() => navigate("/login")} className="text-navy font-medium hover:underline">
              Sign in
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
