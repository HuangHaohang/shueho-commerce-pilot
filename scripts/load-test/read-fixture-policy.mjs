export const READ_FIXTURE_SECRET = 'scale-read-fixture-auth-secret-for-loopback-tests-only';
export const READ_FIXTURE_PROVIDER_KEY = 'scale-catalog-fixture-not-a-provider-secret';

export function validateScaleDatabase(value) {
  if (!value) throw new Error('Set SCALE_DATABASE_URL explicitly to a disposable loopback database.');
  const url = new URL(value);
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      !/^[a-z0-9_]+_scale_[a-z0-9_]+$/.test(name) || url.search || url.hash) {
    throw new Error('Read fixtures require an explicit loopback PostgreSQL database whose name contains _scale_; URL options are forbidden.');
  }
  return { url, name };
}

export function validateScaleWeb(value = 'http://127.0.0.1:3100') {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      !url.port || Number(url.port) < 1024 || ['3000', '8787'].includes(url.port) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Use an explicit isolated loopback Web port, never the daily 3000/8787 services.');
  }
  return url.origin;
}
