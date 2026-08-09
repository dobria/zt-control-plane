import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { controllerSwitchDestination } from "@/lib/controller-navigation";

describe("controller-scoped navigation", () => {
  it("leaves a network detail page for the newly selected network index", () => {
    assert.equal(
      controllerSwitchDestination(
        "/networks/old-controller/8056c2e21c000001",
        "new-controller",
        "zerotier",
      ),
      "/networks?controller=new-controller",
    );
  });

  it("moves node management to the selected compatible controller", () => {
    assert.equal(
      controllerSwitchDestination(
        "/controllers/old-controller/nodes",
        "new-controller",
        "mikrotik",
      ),
      "/controllers/new-controller/nodes",
    );
  });

  it("sends Central selections to networks because Central has no client API", () => {
    assert.equal(
      controllerSwitchDestination(
        "/controllers/old-controller/nodes",
        "central-controller",
        "central_v1",
      ),
      "/networks?controller=central-controller",
    );
  });

  it("does not redirect controller-neutral pages", () => {
    assert.equal(
      controllerSwitchDestination("/controllers", "new-controller", "zerotier"),
      null,
    );
  });
});
