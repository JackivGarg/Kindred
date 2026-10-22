import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PROJECT_ORIGIN = 'https://uhaklwcvscsdsrfgniee.supabase.co';

export function deploymentOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('VITE_APP_URL must be the final HTTPS application origin.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.port ||
    !['', '/'].includes(url.pathname) ||
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.hostname.includes('.')
  ) {
    throw new Error(
      'VITE_APP_URL must be a public HTTPS origin with no path, credentials, port, query or fragment.',
    );
  }
  return url.origin;
}

export function validateDeploymentConfig(env, hosting, { prepare = false } = {}) {
  if (env.VITE_SUPABASE_URL?.trim().replace(/\/$/, '') !== PROJECT_ORIGIN)
    throw new Error(
      'Production must use the dedicated Kindred Supabase project. Set VITE_SUPABASE_URL; demo builds cannot deploy.',
    );
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
  if (!/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(key))
    throw new Error(
      'Set VITE_SUPABASE_PUBLISHABLE_KEY to the public publishable key. Secret/service-role keys are forbidden.',
    );
  const rawOrigin = env.VITE_APP_URL?.trim();
  const origin = rawOrigin ? deploymentOrigin(rawOrigin) : null;
  if (!prepare && !origin)
    throw new Error(
      'Set VITE_APP_URL to the final Azure HTTPS origin. Use -PrepareOnly to obtain a new site hostname first.',
    );
  const csp = hosting?.globalHeaders?.['Content-Security-Policy'] ?? '';
  const connect =
    csp
      .split(';')
      .find((value) => value.trim().startsWith('connect-src '))
      ?.trim()
      .split(/\s+/)
      .slice(1) ?? [];
  if (
    !connect.includes(PROJECT_ORIGIN) ||
    !connect.includes(PROJECT_ORIGIN.replace('https:', 'wss:')) ||
    connect.some(
      (value) =>
        !["'self'", PROJECT_ORIGIN, PROJECT_ORIGIN.replace('https:', 'wss:')].includes(value),
    )
  )
    throw new Error(
      'Hosting CSP connect-src must allow only self and the dedicated Supabase HTTPS/WebSocket origins.',
    );
  if (hosting?.navigationFallback?.rewrite !== '/index.html')
    throw new Error('Hosting configuration must preserve SPA route fallback.');
  return { projectOrigin: PROJECT_ORIGIN, appOrigin: origin };
}

export async function checkPublicAuth({ projectOrigin }, key, fetcher = fetch) {
  const response = await fetcher(`${projectOrigin}/auth/v1/settings`, {
    headers: { apikey: key },
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  });
  if (!response.ok)
    throw new Error(`Supabase public Auth settings are unavailable (HTTP ${response.status}).`);
  const settings = await response.json();
  if (settings?.external?.email !== true)
    throw new Error('Enable the email Auth provider before deploying.');
  if (settings.mailer_autoconfirm !== false)
    throw new Error('Keep email confirmation enabled before deploying public signup.');
  if (settings.disable_signup === true)
    throw new Error('New-account signup is disabled in Supabase Auth.');
  return { emailProvider: 'enabled', smtpDelivery: 'unchecked', authRedirects: 'unchecked' };
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory() ? walk(resolve(directory, entry.name)) : resolve(directory, entry.name),
      ),
    )
  ).flat();
}

export async function checkBuiltAssets(root, key, appOrigin) {
  const directory = resolve(root, 'dist');
  const files = await walk(directory);
  const scripts = await Promise.all(
    files.filter((file) => /\.js$/.test(file)).map((file) => readFile(file, 'utf8')),
  );
  const allScripts = scripts.join('\n');
  if (!allScripts.includes(PROJECT_ORIGIN) || !allScripts.includes(key))
    throw new Error(
      'Build does not contain the expected live Supabase configuration. Rebuild before deploying.',
    );
  if (appOrigin && !allScripts.includes(appOrigin))
    throw new Error('Build does not contain VITE_APP_URL. Rebuild with the final Azure origin.');
  if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(allScripts))
    throw new Error('A secret Supabase key was found in browser output. Deployment stopped.');
  for (const match of allScripts.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) {
    try {
      if (
        JSON.parse(Buffer.from(match[0].split('.')[1], 'base64url').toString()).role ===
        'service_role'
      )
        throw new Error('service_role');
    } catch (error) {
      if (error.message === 'service_role')
        throw new Error('A service-role token was found in browser output. Deployment stopped.');
    }
  }
  const hosting = JSON.parse(
    await readFile(resolve(directory, 'staticwebapp.config.json'), 'utf8'),
  );
  return hosting;
}

export async function runPreflight({
  env = process.env,
  root = process.cwd(),
  fetcher = fetch,
  args = [],
} = {}) {
  const prepare = args.includes('--prepare');
  const hosting = JSON.parse(
    await readFile(resolve(root, 'public/staticwebapp.config.json'), 'utf8'),
  );
  const config = validateDeploymentConfig(env, hosting, { prepare });
  if (args.includes('--built')) {
    const builtHosting = await checkBuiltAssets(
      root,
      env.VITE_SUPABASE_PUBLISHABLE_KEY.trim(),
      config.appOrigin,
    );
    validateDeploymentConfig(env, builtHosting, { prepare });
  }
  const auth = await checkPublicAuth(config, env.VITE_SUPABASE_PUBLISHABLE_KEY.trim(), fetcher);
  return { ...config, ...auth, buildChecked: args.includes('--built') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await runPreflight({ args: process.argv.slice(2) });
    if (process.argv.includes('--json')) console.log(JSON.stringify(result));
    else
      console.log(
        `Production configuration passed. Email provider enabled. SMTP delivery and Auth redirect allowlist require verification in Supabase. ${result.appOrigin ? `Application: ${result.appOrigin}` : 'Prepare mode: final hostname not yet assigned.'}`,
      );
  } catch (error) {
    console.error(`Preflight failed: ${error.message}`);
    process.exitCode = 1;
  }
}
