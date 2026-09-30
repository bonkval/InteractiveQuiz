const test = require('node:test');
const assert = require('node:assert/strict');

function response() {
  return {code:0, payload:null, setHeader(){}, status(code){this.code=code;return this;}, json(payload){this.payload=payload;return this;}};
}

test('account deletion rejects unsupported methods and missing server configuration', async () => {
  const {default:handler} = await import('./api/delete-account.mjs');
  const wrongMethod = response();
  await handler({method:'GET',headers:{}}, wrongMethod);
  assert.equal(wrongMethod.code, 405);
  const unconfigured = response();
  await handler({method:'POST',headers:{}}, unconfigured);
  assert.equal(unconfigured.code, 503);
});
