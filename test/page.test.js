import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPage } from '../src/remote/page.js';

test('home page shows an organisation logo only from this server', () => {
  const plain = renderPage();
  assert.doesNotMatch(plain, /class="brandlogo"/);

  const branded = renderPage({ brand: { logo: '/brand/logo.webp', name: 'Example "Co"', url: 'https://example.com/' } });
  assert.match(branded, /<a class="brand" href="https:\/\/example.com\/" rel="noopener"><img src="\/brand\/logo.webp" alt="Example &quot;Co&quot;" class="brandlogo"><\/a>/);

  // Another site's image would break the 'self' CSP, and a script URL must never become a link.
  assert.doesNotMatch(renderPage({ brand: { logo: 'https://evil.example/x.png' } }), /class="brandlogo"/);
  assert.doesNotMatch(renderPage({ brand: { logo: '/logo.webp', url: 'javascript:alert(1)' } }), /javascript:/);
});
