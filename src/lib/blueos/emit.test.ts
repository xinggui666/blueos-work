import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildArtifact } from "./emit.server.ts";
import { makeSample, projectToDsl } from "./model.ts";

describe("blueos source emit", () => {
  it("emits a studio-shaped source zip and refuses to call it a build", () => {
    const artifact = buildArtifact(projectToDsl(makeSample()));
    assert.equal(artifact.ok, true);
    if (!artifact.ok) return;
    assert.equal(artifact.artifactType, "source_zip");
    assert.equal(artifact.compiled, false);
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
    const ux = artifact.files.find((file) => file.path === "src/pages/Home/index.ux")?.text || "";
    assert.match(ux, /<text class="[^"]+" show="\{\{vis_/);
    assert.match(ux, /<progress /);
    assert.match(ux, /router\.push/);
    assert.match(ux, /import router from '@blueos.app.appmanager.router'/);
    assert.match(ux, /position: absolute;/);
    assert.doesNotMatch(ux, /<image[^>]*onclick/);
    const settings = artifact.files.find((file) => file.path === "src/pages/Settings/index.ux")?.text || "";
    assert.match(settings, /prompt\.showToast/);
    assert.match(settings, /blueos\.window\.prompt|import prompt/);
    const manifest = artifact.files.find((file) => file.path === "src/manifest.json")?.text || "";
    assert.match(manifest, /"package": "com.example.hello"/);
    assert.match(manifest, /"entry": "Home"/);
    assert.match(manifest, /"designWidth": 466/);
    assert.match(manifest, /blueos\.window\.prompt/);
    const app = artifact.files.find((file) => file.path === "src/app.ux")?.text || "";
    assert.match(app, /\/\*\*manifest\*\*\//);
    const zip = Buffer.from(artifact.zipBase64, "base64");
    assert.equal(zip.subarray(0, 2).toString(), "PK");
    assert.equal(artifact.files.some((file) => file.path.endsWith(".rpk")), false);
  });

  it("rejects an unknown component instead of inventing a tag", () => {
    const dsl = projectToDsl(makeSample()) as unknown as { pages: { components: { type: string }[] }[] };
    dsl.pages[0].components[0].type = "magic-widget";
    const artifact = buildArtifact(dsl);
    assert.equal(artifact.ok, false);
    if (artifact.ok) return;
    assert.ok(artifact.issues.some((issue) => issue.level === "error"));
  });
});
