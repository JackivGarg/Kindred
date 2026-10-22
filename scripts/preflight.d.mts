export const PROJECT_ORIGIN: string;
interface Hosting {
  navigationFallback?: { rewrite?: string };
  globalHeaders?: Record<string, string>;
}
interface DeploymentConfig {
  projectOrigin: string;
  appOrigin: string | null;
}
interface PublicAuth {
  emailProvider: string;
  smtpDelivery: string;
  authRedirects: string;
}
export function deploymentOrigin(value: string): string;
export function validateDeploymentConfig(
  env: Record<string, string | undefined>,
  hosting: Hosting,
  options?: { prepare?: boolean },
): DeploymentConfig;
export function checkPublicAuth(
  config: Pick<DeploymentConfig, 'projectOrigin'>,
  key: string,
  fetcher?: typeof fetch,
): Promise<PublicAuth>;
export function checkBuiltAssets(
  root: string,
  key: string,
  appOrigin: string | null,
): Promise<Hosting>;
export function runPreflight(options?: {
  env?: Record<string, string | undefined>;
  root?: string;
  fetcher?: typeof fetch;
  args?: string[];
}): Promise<DeploymentConfig & PublicAuth & { buildChecked: boolean }>;
