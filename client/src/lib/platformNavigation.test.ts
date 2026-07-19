import { describe, expect, it } from "vitest";
import {
  hasPumpTargetAccess,
  platformSectionForPath,
  secondaryPlatformNav,
} from "./platformNavigation";

describe("platform navigation", () => {
  it("hides Pump Targets from Portable Air-only users", () => {
    expect(hasPumpTargetAccess("user", ["Portable Air", "Nitrogen"])).toBe(false);
    expect(secondaryPlatformNav("user", ["Portable Air"]).some(item => item.key === "pump-targets"))
      .toBe(false);
  });

  it("shows Pump Targets for pump and dewatering users", () => {
    expect(hasPumpTargetAccess("user", ["Pump/Dewatering"])).toBe(true);
    expect(hasPumpTargetAccess("user", ["Pump (Flow)"])).toBe(true);
    expect(secondaryPlatformNav("user", ["Pump/Dewatering"]).some(item => item.label === "Pump Targets"))
      .toBe(true);
  });

  it("shows Pump Targets and Admin tools to admins", () => {
    const items = secondaryPlatformNav("admin", ["Portable Air"]);
    expect(items.some(item => item.key === "pump-targets")).toBe(true);
    expect(items.some(item => item.key === "admin")).toBe(true);
  });

  it("keeps My Working Style and Settings in the secondary menu", () => {
    const items = secondaryPlatformNav("user", ["Portable Air"]);
    expect(items.map(item => item.key)).toEqual(["my-style", "settings"]);
  });

  it("maps all Full Potential subroutes to one active section", () => {
    expect(platformSectionForPath("/full-potential")).toBe("full-potential");
    expect(platformSectionForPath("/full-potential/pilot")).toBe("full-potential");
    expect(platformSectionForPath("/full-potential/commercial-model")).toBe("full-potential");
  });

  it("distinguishes This Week from Explore Projects", () => {
    expect(platformSectionForPath("/")).toBe("this-week");
    expect(platformSectionForPath("/this-week")).toBe("this-week");
    expect(platformSectionForPath("/dashboard")).toBe("explore-projects");
  });
});
