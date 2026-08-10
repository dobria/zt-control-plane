import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const overlay = readFileSync("compose.embedded.yaml", "utf8");
const standalone = readFileSync("compose.embedded.standalone.yaml", "utf8");

describe("embedded deployment configuration", () => {
  it("grants the documented TUN capabilities in both Compose variants", () => {
    for (const configuration of [overlay, standalone]) {
      assert.match(configuration, /- NET_ADMIN/);
      assert.match(configuration, /- SYS_ADMIN/);
      assert.match(configuration, /\/dev\/net\/tun:\/dev\/net\/tun/);
    }
  });

  it("keeps application and ZeroTier state in the persistent data volume", () => {
    assert.match(standalone, /COMPOSE_PROJECT_NAME:-zerotier-control-plane}/);
    assert.match(standalone, /control-plane-data:\/data/);
    assert.match(standalone, /target: embedded-runtime/);
    assert.match(standalone, /EMBEDDED_ZEROTIER: "1"/);
    assert.match(standalone, /ZT_LOCAL_TOKEN_PATH:/);
  });
});
