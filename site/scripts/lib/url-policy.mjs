function ensureTrailingSlash(pathname) {
  const normalized = pathname.replace(/\/{2,}/g, '/');
  if (normalized === '/') {
    return '/';
  }

  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

export function normalizeBasePath(basePath) {
  if (!basePath || basePath === '/') {
    return '/';
  }

  const trimmed = basePath.replace(/\/{2,}/g, '/').replace(/^\/?|\/?$/g, '');
  return trimmed ? `/${trimmed}/` : '/';
}

export function canonicalPathSerializer(pathname, basePath = '/') {
  const isFilePath = /\.[a-z0-9]+$/i.test(pathname);
  const normalizedPathname =
    pathname === '/' ? '/' : isFilePath ? pathname.replace(/\/{2,}/g, '/') : ensureTrailingSlash(pathname);
  const safeBasePath = normalizeBasePath(basePath);
  if (normalizedPathname === '/') {
    return safeBasePath;
  }

  const prefixed = `${safeBasePath}${normalizedPathname.replace(/^\//, '')}`;
  return isFilePath ? prefixed.replace(/\/{2,}/g, '/') : ensureTrailingSlash(prefixed);
}

export function redirectMatcher(pathname, basePath = '/') {
  const canonicalPath = canonicalPathSerializer(pathname, basePath);
  return canonicalPath.replace(/\/$/, '');
}

export function normalizeSiteOrigin(value) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  if (!candidate) {
    return null;
  }

  try {
    const url = new URL(candidate);
    url.pathname = '/';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function resolvePreviewOrigin(env) {
  const explicitPreviewOrigin =
    normalizeSiteOrigin(env.SITE_PREVIEW_URL) ||
    normalizeSiteOrigin(env.PREVIEW_URL) ||
    normalizeSiteOrigin(env.DEPLOY_PRIME_URL) ||
    normalizeSiteOrigin(env.DEPLOY_URL);

  if (explicitPreviewOrigin) {
    return explicitPreviewOrigin;
  }

  if (env.VERCEL_BRANCH_URL) {
    return normalizeSiteOrigin(`https://${env.VERCEL_BRANCH_URL}`);
  }

  if (env.VERCEL_URL) {
    return normalizeSiteOrigin(`https://${env.VERCEL_URL}`);
  }

  return null;
}

export function resolveBuildContext(env = process.env) {
  const buildMode = env.SITE_BUILD_ENV || env.VERCEL_ENV || 'local';
  const basePath = normalizeBasePath(env.BASE_PATH || '/');

  if (buildMode === 'production') {
    const origin = normalizeSiteOrigin(env.SITE_URL);
    return {
      mode: 'production',
      origin,
      basePath,
      robotsContent: 'index, follow',
      requiresHttps: true,
    };
  }

  if (buildMode === 'preview') {
    const origin = resolvePreviewOrigin(env);
    return {
      mode: 'preview',
      origin,
      basePath,
      robotsContent: 'noindex, nofollow',
      requiresHttps: false,
    };
  }

  return {
    mode: 'local',
    origin: normalizeSiteOrigin(env.LOCAL_SITE_URL) || 'http://localhost:4173',
    basePath,
    robotsContent: 'noindex, nofollow',
    requiresHttps: false,
  };
}

export function validateBuildContext(context) {
  const errors = [];

  if (!context.origin) {
    errors.push('Missing site origin for the selected build mode');
    return errors;
  }

  try {
    const origin = new URL(context.origin);
    if (context.mode === 'production' && origin.protocol !== 'https:') {
      errors.push('Production SITE_URL must be HTTPS');
    }
  } catch {
    errors.push('Resolved site origin is invalid');
  }

  return errors;
}

export function sitemapUrlBuilder(pathname, context) {
  const canonicalPath = canonicalPathSerializer(pathname, context.basePath);
  return new URL(canonicalPath, `${context.origin}/`).toString();
}
