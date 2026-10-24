import test from 'node:test';
import assert from 'node:assert/strict';
import {demoAccount,editProfile,validateImageFile,isLocalImage} from '../src/prototype.js';

test('demo email login reuses the saved identity without storing a password',()=>{
  const user=demoAccount({},' Person@Example.org ','Person');
  assert.equal(user.email,'person@example.org');
  const saved={...user,address:{province:'Bangkok'}};
  assert.deepEqual(demoAccount({[user.id]:saved},'PERSON@example.org'),saved);
  assert.equal(Object.hasOwn(user,'password'),false);
  assert.throws(()=>demoAccount({},'bad'),{code:'prototypeInvalidEmail'});
  assert.throws(()=>demoAccount({},'a'.repeat(250)+'@example.org'),{code:'prototypeInvalidEmail'});
  assert.throws(()=>demoAccount({},'person@example.org','x'.repeat(71)),{code:'prototypeInvalidProfile'});
});
test('profile edits preserve identity, seller permissions and address',()=>{
  const user={id:'demo-seller',role:'seller',sellerId:'s1',address:{houseNo:'1'}};
  const edited=editProfile(user,{name:' Shop ',email:'shop@example.org',bio:'Hello',id:'other',role:'member'});
  assert.equal(edited.id,user.id);assert.equal(edited.role,'seller');assert.equal(edited.sellerId,'s1');
  assert.deepEqual(edited.address,user.address);assert.equal(edited.name,'Shop');
  assert.throws(()=>editProfile(user,{name:' '}),{code:'prototypeInvalidProfile'});
  assert.throws(()=>editProfile(user,{name:'Shop',email:'bad'}),{code:'prototypeInvalidEmail'});
  assert.throws(()=>editProfile(user,{name:'Shop',bio:'x'.repeat(161)}),{code:'prototypeInvalidProfile'});
});
test('local image boundary rejects SVG, oversized files and remote or active URLs',()=>{
  validateImageFile({type:'image/png',size:1024});
  for(const file of [{type:'image/svg+xml',size:20},{type:'image/png',size:6*1024*1024},{type:'image/jpeg',size:0}])assert.throws(()=>validateImageFile(file),{code:'prototypeInvalidImage'});
  assert.equal(isLocalImage('data:image/jpeg;base64,YWJj'),true);
  for(const value of ['https://example.org/image.jpg','javascript:alert(1)','data:image/svg+xml;base64,YWJj','data:image/jpeg;base64," onerror="', 'data:image/jpeg;base64,'+'A'.repeat(350000)])assert.equal(isLocalImage(value),false);
});
