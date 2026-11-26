import test from "node:test";
import assert from "node:assert/strict";
import { parseGroupLink } from "../src/group-link.js";

test("full invite link from any domain keeps path and invite token", () => {
  assert.equal(
    parseGroupLink("https://harnkhong.vercel.app/groups/abc-123?invite=tok%2B1&openExternalBrowser=1"),
    "/groups/abc-123?invite=tok%2B1",
  );
});

test("link inside a chat message", () => {
  assert.equal(
    parseGroupLink("มาหาร Spotify กัน https://hamsterworkspace.site/groups/g42 ว่าง 2 ที่"),
    "/groups/g42",
  );
});

test("join and chat subpages go to the group page", () => {
  assert.equal(parseGroupLink("https://x.site/groups/g42/join?invite=t"), "/groups/g42?invite=t");
  assert.equal(parseGroupLink("/groups/g42/chat"), "/groups/g42");
});

test("link without scheme and bare id", () => {
  assert.equal(parseGroupLink("hamsterworkspace.site/groups/g42"), "/groups/g42");
  assert.equal(parseGroupLink("9b2f4c1e-0000-4000-8000-000000000000"), "/groups/9b2f4c1e-0000-4000-8000-000000000000");
});

test("rejects things that are not group links", () => {
  for (const value of ["", "hello", "https://x.site/explore", "/groups/create", "https://x.site/groups/"])
    assert.equal(parseGroupLink(value), null, value);
});
