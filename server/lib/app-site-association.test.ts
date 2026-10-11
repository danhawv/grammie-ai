import { describe, expect, it } from "vitest";
import { appSiteAssociation } from "./app-site-association";

describe("appSiteAssociation", () => {
  it("lists the app with its link paths when the team id is set", () => {
    const file = appSiteAssociation("ABCDE12345");
    expect(file.applinks.details[0].appIDs).toEqual(["ABCDE12345.ai.grammie.app"]);
    expect(file.applinks.details[0].components).toContainEqual({ "/": "/sso-callback*" });
    expect(file.applinks.details[0].components).toContainEqual({ "/": "/recipe/*" });
    expect(file.webcredentials.apps).toEqual(["ABCDE12345.ai.grammie.app"]);
  });

  it("lists no apps without a team id", () => {
    expect(appSiteAssociation(undefined)).toEqual({ applinks: { details: [] }, webcredentials: { apps: [] } });
    expect(appSiteAssociation("  ").applinks.details).toEqual([]);
  });
});
