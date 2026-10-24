import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createAuthSessionSync} from '../src/auth-session.js';

// Run the actual app session/refresh wiring without the unrelated DOM renderer.
const source=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const sessionSource=source.slice(source.indexOf('async function fetchSupabaseState('));
const snapshot=id=>({groups:id?[{id}]:[],names:id?{[id]:{name:id}}:{},listings:[],sellers:[]});
const session=id=>({user:{id}});
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function app(){
  const requests=[],errors=[],scheduled=[],finished=[],sessionStore=new Map();
  let authChanged;
  const context=vm.createContext({
    createAuthSessionSync,URLSearchParams,supabaseConfigured:true,activeSupabaseSession:null,
    state:{user:null,groups:[],profiles:{}},groupsError:null,groupsLoading:false,
    authModalActive:false,tempSignupData:{},mockupCurrentStep:1,
    location:{pathname:'/',search:''},window:{addEventListener(){}},
    loadAuthenticatedUser:async user=>({...user,address:{}}),
    loadSupabaseGroups:()=>requests.shift()||Promise.resolve(snapshot()),
    resolveSupabaseInvite:async()=>null,refreshAuthProviders:async()=>{},
    supabase:{auth:{onAuthStateChange(callback){authChanged=callback;}}},
    sessionStorage:{getItem:key=>sessionStore.get(key)||null},
    setTimeout:callback=>scheduled.push(callback),render(){},finishAuth(user){finished.push(user.id);sessionStore.delete('harn-return');context.authModalActive=false;},
    authErrorMessage:error=>error.message,alertMessage:error=>errors.push(error),
  });
  vm.runInContext(sessionSource,context);
  return {context,requests,errors,scheduled,authChanged,sessionStore,finished};
}

test('pending group refresh cannot restore private groups after logout',async()=>{
  const {context:c,requests,authChanged,scheduled}=app();
  const a=session('A');requests.push(Promise.resolve(snapshot('private-A')));
  await c.syncSupabaseSession(a);
  const pending=deferred();requests.push(pending.promise);
  const refresh=c.refreshSupabaseGroups();
  await new Promise(setImmediate);
  c.tempSignupData={email:'A@example.test'};c.authModalActive=true;
  authChanged('SIGNED_OUT',null);
  assert.equal(c.state.user,null);
  assert.equal(c.state.groups.length,0);
  assert.equal(c.authModalActive,false);
  assert.equal(Object.keys(c.tempSignupData).length,0);
  await scheduled.shift()();
  pending.resolve(snapshot('private-A'));
  assert.equal(await refresh,undefined);
  assert.equal(c.state.user,null);
  assert.equal(c.state.groups.length,0);
});

test('old account refresh errors cannot clear the new account',async()=>{
  const {context:c,requests,errors}=app();
  const a=session('A');requests.push(Promise.resolve(snapshot('private-A')));
  await c.syncSupabaseSession(a);
  const pending=deferred();requests.push(pending.promise);
  const old=c.refreshSupabaseGroups();
  requests.push(Promise.resolve(snapshot('private-B')));
  await c.syncSupabaseSession(session('B'));
  pending.reject(new Error('old request failed'));
  assert.equal(await old,undefined);
  assert.equal(c.state.user.id,'B');
  assert.equal(c.state.groups[0].id,'private-B');
  assert.deepEqual(errors,[]);
  assert.equal(await c.refreshSupabaseGroups(a),undefined);
  assert.equal(c.state.user.id,'B');
});

test('latest group refresh wins even when an earlier response arrives last',async()=>{
  const {context:c,requests}=app();
  const a=session('A');requests.push(Promise.resolve(snapshot('initial')));
  await c.syncSupabaseSession(a);
  const first=deferred(),second=deferred();
  requests.push(first.promise,second.promise);
  const old=c.refreshSupabaseGroups(),latest=c.refreshSupabaseGroups();
  second.resolve(snapshot('latest'));assert.equal((await latest).groups[0].id,'latest');
  first.resolve(snapshot('stale'));assert.equal(await old,undefined);
  assert.equal(c.state.groups[0].id,'latest');
});

test('retry recovers the authenticated account after a failed group load',async()=>{
  const {context:c,requests}=app();
  const a=session('A');requests.push(Promise.resolve(snapshot('initial')));
  await c.syncSupabaseSession(a);
  const pending=deferred();requests.push(pending.promise);
  const refresh=c.refreshSupabaseGroups();pending.reject(new Error('offline'));
  await assert.rejects(refresh,/offline/);
  assert.equal(c.state.user,null);
  requests.push(Promise.resolve(snapshot('recovered')));
  await c.refreshSupabaseGroups();
  assert.equal(c.state.user.id,'A');
  assert.equal(c.state.groups[0].id,'recovered');
  assert.equal(c.groupsError,null);
});

test('modal login completes a saved return route; ordinary session refresh does not navigate',async()=>{
  const {context:c,sessionStore,finished}=app();
  c.authModalActive=true;sessionStore.set('harn-return','/groups/create');
  const a=session('A');
  await c.syncSupabaseSession(a);
  assert.deepEqual(finished,['A']);
  assert.equal(c.authModalActive,false);
  assert.equal(sessionStore.has('harn-return'),false);
  await c.refreshSupabaseGroups();
  assert.deepEqual(finished,['A']);
});
