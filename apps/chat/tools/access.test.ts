import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAccess, viewerFromHeaders } from "./access.ts";

const EVT = "11111111-2222-4333-8444-555555555555";

test("viewer extraction: token gates trust; placeholder or empty subject is not an identity", () => {
  assert.deepEqual(viewerFromHeaders({ "x-darkspot-subject": "u1" }, undefined), { subject: "u1", trusted: true });
  assert.deepEqual(viewerFromHeaders({ "x-darkspot-subject": "u1", "x-darkspot-tools-token": "s" }, "s"), { subject: "u1", trusted: true });
  assert.deepEqual(viewerFromHeaders({ "x-darkspot-subject": "u1", "x-darkspot-tools-token": "wrong" }, "s"), { subject: null, trusted: false });
  assert.deepEqual(viewerFromHeaders({ "x-darkspot-subject": "u1" }, "s"), { subject: null, trusted: false });
  assert.equal(viewerFromHeaders({ "x-darkspot-subject": "{{LIBRECHAT_USER_ID}}" }, undefined).subject, null);
  assert.equal(viewerFromHeaders({}, undefined).subject, null);
});

test("resolveAccess fails closed on every branch", async () => {
  const q = async () => ({ rows: [] });
  assert.equal((await resolveAccess({ subject: null, trusted: false }, EVT, q)).authorized, false);
  assert.equal((await resolveAccess({ subject: null, trusted: true }, EVT, q)).authorized, false);
  assert.match((await resolveAccess({ subject: "u1", trusted: true }, EVT, null)).reason, /DATABASE_URL unset/);
  assert.match((await resolveAccess({ subject: "u1", trusted: true }, null, q)).reason, /no disaster_event_id/);
  assert.match((await resolveAccess({ subject: "u1", trusted: true }, EVT, q)).reason, /not a registered/);
  const boom = async () => { throw new Error("db down"); };
  const r = await resolveAccess({ subject: "u1", trusted: true }, EVT, boom);
  assert.equal(r.authorized, false);
  assert.match(r.reason, /db down/);
});

test("only an individual_pii grant authorizes; the query binds subject and event", async () => {
  let seen: unknown[] = [];
  const grant = async (_sql: string, params: unknown[]) => { seen = params; return { rows: [{ principal_id: "p1", role: "responder", level: "individual_pii" }] }; };
  const r = await resolveAccess({ subject: "u1", trusted: true }, EVT, grant);
  assert.equal(r.authorized, true);
  assert.equal(r.level, "individual_pii");
  assert.deepEqual(seen, ["u1", EVT]);
  const agg = async () => ({ rows: [{ principal_id: "p1", role: "observer", level: "aggregate_only" }] });
  assert.equal((await resolveAccess({ subject: "u1", trusted: true }, EVT, agg)).authorized, false);
  const noGrant = async () => ({ rows: [{ principal_id: "p1", role: "coordinator", level: null }] });
  assert.equal((await resolveAccess({ subject: "u1", trusted: true }, EVT, noGrant)).authorized, false);
});
