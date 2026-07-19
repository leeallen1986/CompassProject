import "./fullPotentialDailyActivation.shared";

declare module "./fullPotentialDailyActivation.shared" {
  interface DailyActivationSignal {
    actionState?: {
      hasOpenAction: boolean;
    };
  }
}
