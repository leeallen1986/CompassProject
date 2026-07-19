import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import DeploymentProvenanceBadge from "./components/DeploymentProvenanceBadge";
import FullPotentialCommercialModelLink from "./components/FullPotentialCommercialModelLink";
import FullPotentialDataQualityLink from "./components/FullPotentialDataQualityLink";
import FullPotentialPilotLink from "./components/FullPotentialPilotLink";
import FullPotentialRentalHireLink from "./components/FullPotentialRentalHireLink";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ResetPassword from "./pages/ResetPassword";
import Onboarding from "./pages/Onboarding";
import Settings from "./pages/Settings";
import Admin from "./pages/Admin";
import MyProfile from "./pages/MyProfile";
import CollateralLibrary from "./pages/CollateralLibrary";
import Campaigns from "./pages/Campaigns";
import ProjectDetail from "./pages/ProjectDetail";
import ContactValidation from "./pages/ContactValidation";
import WaterfallHealth from "./pages/WaterfallHealth";
import DeploymentDiagnostics from "./pages/DeploymentDiagnostics";
import {
  AccountIntelligenceRoute,
  ExploreProjectsRoute,
  FullPotentialCommercialModelRoute,
  FullPotentialDataQualityRoute,
  FullPotentialPilotRoute,
  FullPotentialRentalHireRoute,
  FullPotentialRoute,
  PumpTargetsRoute,
  PursuitsRoute,
  ThisWeekRoute,
} from "./pages/PlatformSalesRoutes";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={ThisWeekRoute} />
      <Route path={"/this-week"} component={ThisWeekRoute} />
      <Route path={"/project/:id"} component={ProjectDetail} />
      <Route path={"/dashboard"} component={ExploreProjectsRoute} />
      <Route path={"/login"} component={Login} />
      <Route path={"/register"} component={Register} />
      <Route path={"/reset-password"} component={ResetPassword} />
      <Route path={"/onboarding"} component={Onboarding} />
      <Route path={"/settings"} component={Settings} />
      <Route path={"/pipeline"} component={PursuitsRoute} />
      <Route path={"/admin/deployment"} component={DeploymentDiagnostics} />
      <Route path={"/admin/waterfall"} component={WaterfallHealth} />
      <Route path={"/admin"} component={Admin} />
      <Route path={"/my-profile"} component={MyProfile} />
      <Route path={"/collateral"} component={CollateralLibrary} />
      <Route path={"/campaigns"} component={Campaigns} />
      <Route path={"/account-attack"} component={AccountIntelligenceRoute} />
      <Route path={"/contact-validation"} component={ContactValidation} />
      <Route path={"/account-priors"} component={PumpTargetsRoute} />
      <Route path={"/full-potential/pilot"} component={FullPotentialPilotRoute} />
      <Route path={"/full-potential/commercial-model"} component={FullPotentialCommercialModelRoute} />
      <Route path={"/full-potential/data-quality"} component={FullPotentialDataQualityRoute} />
      <Route path={"/full-potential/rental-hire"} component={FullPotentialRentalHireRoute} />
      <Route path={"/full-potential"} component={FullPotentialRoute} />
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
          <FullPotentialDataQualityLink />
          <FullPotentialRentalHireLink />
          <FullPotentialCommercialModelLink />
          <FullPotentialPilotLink />
          <DeploymentProvenanceBadge />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
