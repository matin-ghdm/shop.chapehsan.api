const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRequestAttachments, MAX_IMAGE_ATTACHMENT_BYTES, MAX_ATTACHMENT_BYTES } = require('../src/lib/request-attachments');
const file = (name, size, path = name) => ({ name, size, url: `https://uploads.public.blob.vercel-storage.com/request-attachments/${path}` });

test('image attachments obey the smaller image limit while print documents keep their document limit', () => {
  assert.equal(parseRequestAttachments([file('photo.JPG', MAX_IMAGE_ATTACHMENT_BYTES)]).length, 1);
  assert.equal(parseRequestAttachments([file('photo.JPG', MAX_IMAGE_ATTACHMENT_BYTES + 1)]), null);
  assert.equal(parseRequestAttachments([file('renamed.pdf', MAX_IMAGE_ATTACHMENT_BYTES + 1, 'actual-image.png')]), null);
  assert.equal(parseRequestAttachments([file('design.pdf', MAX_ATTACHMENT_BYTES)]).length, 1);
  assert.equal(parseRequestAttachments([file('design.pdf', MAX_ATTACHMENT_BYTES + 1)]), null);
});
