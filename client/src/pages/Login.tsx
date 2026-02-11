/**
 * Login Page — Dual auth: email/password for distributors + Manus OAuth for internal team
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getLoginUrl } from "@/const";
import { Eye, EyeOff, Loader2, Mail, Lock, ArrowRight } from "lucide-react";
import { toast } from "sonner";

export default function Login() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const loginMutation = trpc.auth.loginWithEmail.useMutation({
    onSuccess: () => {
      toast.success("Logged in successfully");
      navigate("/");
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Please enter your email and password");
      return;
    }
    loginMutation.mutate({ email, password });
  };

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
              Real-time project<br />intelligence for<br />
              <span className="text-gold">smarter decisions</span>
            </h1>
            <p className="text-slate-300 text-base max-w-md leading-relaxed">
              Access curated mining, energy, and infrastructure project data across Australia.
              Powered by AI-driven analysis and multi-source intelligence gathering.
            </p>
          </div>
          <p className="text-slate-500 text-xs">
            &copy; {new Date().getFullYear()} Atlas Copco. All rights reserved.
          </p>
        </div>
      </div>

      {/* Right panel — login form */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md space-y-8">
          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-8">
            <div className="text-xl font-bold tracking-wider text-navy">ATLAS COPCO</div>
            <p className="text-muted-foreground text-sm">Market Intelligence Platform</p>
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-navy">Sign in to your account</h2>
            <p className="text-muted-foreground text-sm">
              Enter your email and password to access the platform
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium text-foreground">
                Email address
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10 h-11"
                  autoComplete="email"
                  autoFocus
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium text-foreground">
                Password
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 pr-10 h-11"
                  autoComplete="current-password"
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

            <Button
              type="submit"
              disabled={loginMutation.isPending}
              className="w-full h-11 bg-navy hover:bg-navy-light text-white font-semibold gap-2"
            >
              {loginMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  Sign in <ArrowRight className="w-4 h-4" />
                </>
              )}
            </Button>
          </form>

          {/* Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-3 text-muted-foreground font-medium">
                Or continue with
              </span>
            </div>
          </div>

          {/* Manus OAuth */}
          <Button
            variant="outline"
            className="w-full h-11 gap-2 font-medium"
            onClick={() => { window.location.href = getLoginUrl(); }}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
              <rect width="24" height="24" rx="4" fill="#1a1a2e" />
              <rect x="4" y="4" width="7" height="7" rx="1.5" fill="white" />
              <rect x="13" y="4" width="7" height="7" rx="1.5" fill="white" />
              <rect x="4" y="13" width="7" height="7" rx="1.5" fill="white" />
              <rect x="13" y="13" width="7" height="7" rx="1.5" fill="white" />
            </svg>
            Sign in with Manus
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            Internal team members can use Manus login. Distributors use email/password.
            <br />
            Need access? Contact your Atlas Copco representative.
          </p>
        </div>
      </div>
    </div>
  );
}
