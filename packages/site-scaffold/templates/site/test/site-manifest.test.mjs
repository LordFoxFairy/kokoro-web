import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("release and deployment remain owned by this Site project", async () => {
  const artifact = JSON.parse(await readFile("deploy/artifact-manifest.json", "utf8"));
  const deployment = JSON.parse(await readFile("deploy/site-deployment.json", "utf8"));
  assert.equal(artifact.releaseId, deployment.releaseId);
  assert.equal(deployment.rollbackAuthority, "site-project");
  assert.equal(deployment.activationMode, "platform-exact-binding");
});
