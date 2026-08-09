import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import { after, before, describe, it } from "node:test";
import { auditCsv, listAuditPage, parseAuditRequest } from "@/lib/audit";
import { closeDatabaseForTests, db } from "@/lib/database";
import { ValidationError } from "@/lib/validation";

const databaseFile = path.join(tmpdir(), `ztcp-audit-${randomUUID()}.sqlite`);
const userId = `audit-user-${randomUUID()}`;

before(() => {
  process.env.DATABASE_PATH = databaseFile;
  process.env.EMBEDDED_ZEROTIER = "1";
  process.env.APP_SECRET = "audit-test-secret-that-is-long-enough";
  const database = db();
  database
    .prepare(
      `INSERT INTO users
       (id,email,display_name,password_hash,role,disabled,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(
      userId,
      "auditor@example.com",
      "Audit user",
      "test",
      "auditor",
      0,
      1,
      1,
    );
  const insert = database.prepare(
    `INSERT INTO audit_log
     (timestamp,user_id,controller_id,node_id,action,method,target,status,ok,detail)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  for (let index = 1; index <= 60; index += 1) {
    insert.run(
      10_000 + index,
      index % 3 ? userId : null,
      index % 4 ? "embedded-local" : null,
      index % 5 ? "embedded-local-node" : null,
      index % 2 ? "network.update" : "member.update",
      "PUT",
      index === 17 ? "literal%value" : `target-${index}`,
      index % 6 ? 200 : 400,
      index % 6 ? 1 : 0,
      `detail-${index}`,
    );
  }
  insert.run(
    20_000,
    userId,
    null,
    null,
    "danger.export",
    "GET",
    '=HYPERLINK("https://example.invalid")',
    200,
    1,
    null,
  );
});

after(() => closeDatabaseForTests());

describe("audit querying", () => {
  it("validates request pagination and time ranges", () => {
    assert.deepEqual(parseAuditRequest(new URLSearchParams()), {
      filters: {
        search: undefined,
        action: undefined,
        actor: undefined,
        controller: undefined,
        node: undefined,
        result: undefined,
        from: undefined,
        to: undefined,
      },
      page: 1,
      pageSize: 25,
    });
    assert.throws(
      () => parseAuditRequest(new URLSearchParams("pageSize=500")),
      ValidationError,
    );
    assert.throws(
      () => parseAuditRequest(new URLSearchParams("from=20&to=10")),
      ValidationError,
    );
  });

  it("paginates on the server and returns filter options", () => {
    const result = listAuditPage({}, 2, 25);
    assert.deepEqual(result.pagination, {
      page: 2,
      pageSize: 25,
      total: 61,
      totalPages: 3,
    });
    assert.equal(result.entries.length, 25);
    assert.ok(result.options.actions.includes("network.update"));
    assert.ok(
      result.options.users.some((user) => user.label === "auditor@example.com"),
    );
    assert.ok(
      result.options.controllers.some(
        (controller) => controller.id === "embedded-local",
      ),
    );
  });

  it("combines result, actor, action, context and date filters", () => {
    const result = listAuditPage(
      {
        result: "failure",
        actor: "system",
        action: "member.update",
        controller: "embedded-local",
        node: "embedded-local-node",
        from: 10_000,
        to: 11_000,
      },
      1,
      100,
    );
    assert.ok(result.entries.length > 0);
    assert.ok(result.entries.every((entry) => !entry.ok));
    assert.ok(result.entries.every((entry) => entry.userId === null));
    assert.ok(
      result.entries.every((entry) => entry.action === "member.update"),
    );
    assert.ok(
      result.entries.every(
        (entry) =>
          entry.controllerId === "embedded-local" &&
          entry.nodeId === "embedded-local-node",
      ),
    );
  });

  it("treats search wildcards as literal user input", () => {
    const result = listAuditPage({ search: "%" }, 1, 25);
    assert.equal(result.pagination.total, 1);
    assert.equal(result.entries[0].target, "literal%value");
  });
});

describe("audit CSV export", () => {
  it("exports filtered rows and neutralizes spreadsheet formulas", () => {
    const csv = [...auditCsv({ action: "danger.export" })].join("");
    assert.match(csv, /^\uFEFF"ID","Time","Action"/);
    assert.match(csv, /"danger\.export"/);
    assert.match(csv, /"'=HYPERLINK/);
    assert.doesNotMatch(csv, /,"=HYPERLINK/);
  });
});
