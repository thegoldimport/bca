import type { SeoSettings } from "@shared/schema";
import type { PublishedRouteMetadata } from "./published-routes";

type PublishingLink = {
  subdomainSlug?: string | null;
  deploymentScriptName?: string | null;
};

export type PublishingSettingsDependencies = {
  upsertSettings(projectId: number, update: Partial<SeoSettings>): Promise<SeoSettings>;
  getRuntimeLink(projectId: number): Promise<PublishingLink | undefined>;
  setPublishedRoute(slug: string, scriptName: string, metadata: PublishedRouteMetadata): Promise<void>;
};

export async function savePublishingSettings(
  projectId: number,
  update: Partial<SeoSettings>,
  dependencies: PublishingSettingsDependencies,
) {
  const settings = await dependencies.upsertSettings(projectId, update);
  const link = await dependencies.getRuntimeLink(projectId);
  if (link?.subdomainSlug && link.deploymentScriptName) {
    await dependencies.setPublishedRoute(link.subdomainSlug, link.deploymentScriptName, {
      title: settings.metaTitle,
      description: settings.metaDescription,
      canonicalUrl: settings.canonicalUrl,
      ogTitle: settings.ogTitle,
      ogDescription: settings.ogDescription,
      ogImageUrl: settings.ogImageUrl,
      faviconData: settings.faviconData,
      allowIndexing: settings.allowIndexing,
      schemaJson: settings.schemaJson,
    });
  }
  return settings;
}