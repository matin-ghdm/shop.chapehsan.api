const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/routes/digital-cards'), 'utf8');
const helper = source.slice(source.indexOf('function accountAssetUrls('), source.indexOf('\nasync function publicCardBySlug'));
const context = {};
vm.runInNewContext(helper, context);

test('external product order links do not require upload registration; actual files still do', () => {
  const urls = context.accountAssetUrls({
    portrait: 'https://files.example/profile.png',
    products: [{ url: 'https://www.chapehsan.com/hamdardi', image: 'https://files.example/product.png' }],
    gallery: [{ url: 'https://files.example/gallery.png' }],
    catalogs: [{ url: 'https://files.example/catalog.pdf' }],
  });
  assert.deepEqual(Array.from(urls).sort(), ['https://files.example/profile.png', 'https://files.example/product.png', 'https://files.example/gallery.png', 'https://files.example/catalog.pdf'].sort());
  assert.equal(context.accountAssetUrls({ products: [{ url: 'https://www.chapehsan.com/hamdardi' }] }).length, 0);
});
