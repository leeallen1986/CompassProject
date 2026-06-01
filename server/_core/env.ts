export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  apolloApiKey: process.env.APOLLO_API_KEY ?? "",
  projectoryEmail: process.env.PROJECTORY_EMAIL ?? "",
  projectoryPassword: process.env.PROJECTORY_PASSWORD ?? "",
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  /** Absolute base URL for the published app — used for email deep-links. E.g. https://compasspt.manus.space */
  appSiteUrl: (process.env.APP_SITE_URL ?? "").replace(/\/$/, ""),
  hunterApiKey: process.env.HUNTER_API_KEY ?? "",
  lushaApiKey: process.env.LUSHA_API_KEY ?? "",
  /** Secret key for the /api/scheduled/pipeline endpoint — allows Manus scheduled tasks to trigger the pipeline without OAuth. */
  pipelineSecret: process.env.PIPELINE_SECRET ?? "",
};
