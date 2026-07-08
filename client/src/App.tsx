import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import ThisWeek from "./pages/ThisWeekWithFullPotential";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ResetPassword from "./pages/ResetPassword";
import Onboarding from "./pages/Onboarding";
import Settings from "./pages/Settings";
import Pipeline from "./pages/Pipeline";
import Admin from "./pages/Admin";
import MyProfile from "./pages/MyProfile";
import CollateralLibrary from "./pages/CollateralLibrary";
import Campaigns from "./pages/Campaigns";
import AccountAttack from "./pages/AccountAttack";
import ProjectDetail from "./pages/ProjectDetail";
import ContactValidation from "./pages/ContactValidation";
import WaterfallHealth from "./pages/WaterfallHealth";
import AccountPriors from "./pages/AccountPriors";
import FullPotential from "./pages/FullPotential";

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Switch>
      <Route path={"/"} component={ThisWeek} />
      <Route path={"/this-week"} component={ThisWeek} />
      <Route path={"/project/:id"} component={ProjectDetail} />
      <Route path={"/dashboard"} component={Home} />
      <Route path={"/login"} component={Login} />
      <Route path={"/register"} component={Register} />
      <Route path={"/reset-password"} component={ResetPassword} />
      <Route path={"/onboarding"} component={Onboarding} />
      <Route path={"/settings"} component={Settings} />
      <Route path={"/pipeline"} component={Pipeline} />
      <Route path={"/admin"} component={Admin} />
      <Route path={"/my-profile"} component={MyProfile} />
      <Route path={"/collateral"} component={CollateralLibrary} />
      <Route path={"/campaigns"} component={Campaigns} />
      <Route path={"/account-attack"} component={AccountAttack} />
      <Route path={"/contact-validation"} component={ContactValidation} />
      <Route path={"/account-priors"} component={AccountPriors} />
      <Route path={"/full-potential"} component={FullPotential} />
      <Route path={"/admin/waterfall"} component={WaterfallHealth} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
