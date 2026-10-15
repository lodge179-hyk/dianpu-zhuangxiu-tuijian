// All test model traffic must use injected mocks or the local fake HTTP provider.
// Do not load real .env files in tests. This guard also covers child test servers.
const originalFetch = globalThis.fetch;
globalThis.fetch = function (input, options) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw Error('Tests forbid external requests: ' + url.origin);
  return originalFetch(input, options);
};
