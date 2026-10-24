import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthSessionSync} from '../src/auth-session.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

test('stale account load cannot restore A after logout', async () => {
  const pending = deferred(), applied = [], errors = [];
  const current = {id:null};
  const sync = createAuthSessionSync({loadUser:user=>user?pending.promise:Promise.resolve(null),applyUser:user=>{current.id=user?.id||null;applied.push(current.id);},onError:error=>errors.push(error)});
  const old = sync.sync({user:{id:'A'}});
  sync.invalidate();
  await sync.sync(null);
  pending.resolve({id:'A'});
  await old;
  assert.deepEqual(applied,[null]);
  assert.deepEqual(errors,[]);
});

test('stale account load cannot replace B or clear B on an old error', async () => {
  const a = deferred(), b = deferred(), applied = [], errors = [];
  const current = {id:null};
  const sync = createAuthSessionSync({loadUser:user=>user.id==='A'?a.promise:b.promise,applyUser:user=>{current.id=user?.id||null;applied.push(current.id);},onError:error=>errors.push(error)});
  const old = sync.sync({user:{id:'A'}});
  const latest = sync.sync({user:{id:'B'}});
  b.resolve({id:'B'}); await latest;
  a.reject(new Error('old request failed')); await old;
  assert.equal(current.id,'B');
  assert.deepEqual(applied,['B']);
  assert.deepEqual(errors,[]);
});
