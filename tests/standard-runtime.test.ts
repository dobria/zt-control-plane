import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import { after, before, describe, it } from "node:test";
import { closeDatabaseForTests, db } from "@/lib/database";
import { listPublicControllers } from "@/lib/controller-registry";
import { listPublicNodes } from "@/lib/node-registry";

const databaseFile = path.join(
  tmpdir(),
  `ztcp-standard-runtime-${randomUUID()}.sqlite`,
);

before(() => {
  process.env.DATABASE_PATH = databaseFile;
  process.env.APP_SECRET = "standard-runtime-test-secret-long-enough";
  process.env.EMBEDDED_ZEROTIER = "0";
});

after(() => closeDatabaseForTests());

describe("standard open-source runtime", () => {
  it("starts without seeding an embedded controller or local node", () => {
    db();
    assert.deepEqual(listPublicControllers(), []);
    assert.deepEqual(listPublicNodes(), []);
  });
});
