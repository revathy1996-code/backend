const defaultAllowedOrigins = ['http://localhost:4200', 'http://127.0.0.1:4200'];

function getAllowedOrigins() {
  if (!process.env.CORS_ORIGIN) {
    return defaultAllowedOrigins;
  }

  const configuredOrigins = process.env.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (!configuredOrigins.length) {
    return defaultAllowedOrigins;
  }

  return Array.from(new Set([...defaultAllowedOrigins, ...configuredOrigins]));
}

function isOriginAllowed(origin, allowedOrigins) {
  if (!origin) {
    return true;
  }
  return allowedOrigins.includes(origin);
}

module.exports = {
  getAllowedOrigins,
  isOriginAllowed
};
