const test = require('node:test');
const assert = require('node:assert/strict');
const { renderModule, renderPage } = require('../a9-component-library/lib/index.cjs');
const { styles } = require('../a9-component-library/lib/core.cjs');

function navigation(type, labels) {
  return { id: 'nav', type, content: { images: labels.map(label => ({ src: 'assets/nav.png', ...(label === undefined ? {} : { label }) })) }, options: {} };
}

test('four-column labels stay below their own images and inside the page layout', () => {
  const module = navigation('navigation.four', ['护肤', '底妆', '彩妆', '<香氛 & 日常>']);
  const before = JSON.stringify(styles), rendered = renderModule(module);
  const labels = rendered.components.filter(c => c.role === 'fixed-text');
  assert.equal(labels.length, 4);
  labels.forEach((label, i) => {
    const image = rendered.photos[i].rect, [x, y, width, height] = label.rect;
    assert.ok(Math.abs(x + width / 2 - image[0] - image[2] / 2) < .01);
    assert.equal(y - image[1] - image[3], 4);
    assert.ok(y + height <= rendered.height - 16);
    assert.ok(x >= 0 && x + width <= rendered.width);
  });
  assert.match(rendered.html, /font-size:12px/);
  assert.match(rendered.html, /color:rgb\(110, 115, 130\)/);
  assert.match(rendered.html, /&lt;香氛 &amp; 日常>/);
  assert.ok(!rendered.html.includes('<香氛'));
  const page = renderPage({ modules: [module, { ...module, id: 'next' }] });
  assert.equal(page.components.find(c => c.id === 'next' && c.role === 'module').rect[1], rendered.height);
  assert.equal(JSON.stringify(styles), before, 'captured styles must not be mutated');
});

test('unlabelled four-column inputs and existing five-column geometry stay compatible', () => {
  const noLabels = renderModule(navigation('navigation.four', [undefined, '', undefined, ' ']));
  assert.equal(noLabels.height, styles['navigation.four'].height);
  assert.equal(noLabels.components.filter(c => c.role === 'fixed-text').length, 0);
  const five = renderModule(navigation('navigation.five', ['上衣', '衬衫', '裤装', '裙装', '鞋履']));
  assert.equal(five.photos.length, 5);
  assert.equal(five.height, 145.640625);
  for (let i = 1; i <= 5; i++) {
    assert.deepEqual(five.components.find(c => c.id === 'nav.label' + i).rect, styles['navigation.five'].nodes.find(n => n.name === 'DecorateNav_label.' + i).rect);
  }
});
