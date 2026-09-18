export type ProjectDeletionDependencies = {
  getRouteValue(slug: string): Promise<string | null>;
  removeRoute(slug: string): Promise<void>;
  restoreRouteValue(slug: string, value: string): Promise<void>;
  deleteProject(projectId: number): Promise<void>;
};

export class PublishedRouteRestoreError extends Error {
  constructor(
    readonly deleteError: unknown,
    readonly restoreError: unknown,
  ) {
    super("Project deletion failed and its public route could not be restored.");
  }
}

export async function deleteProjectAndPublishedRoute(
  projectId: number,
  link: { subdomainSlug?: string | null; deploymentUrl?: string | null } | undefined,
  dependencies: ProjectDeletionDependencies,
) {
  const publishedSlug = link?.subdomainSlug && link.deploymentUrl ? link.subdomainSlug : null;
  const routeValue = publishedSlug ? await dependencies.getRouteValue(publishedSlug) : null;

  if (publishedSlug) await dependencies.removeRoute(publishedSlug);

  try {
    await dependencies.deleteProject(projectId);
  } catch (error) {
    if (publishedSlug && routeValue !== null) {
      try {
        await dependencies.restoreRouteValue(publishedSlug, routeValue);
      } catch (restoreError) {
        throw new PublishedRouteRestoreError(error, restoreError);
      }
    }
    throw error;
  }
}