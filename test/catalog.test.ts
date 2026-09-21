import assert from "node:assert/strict";
import { test } from "node:test";

import { OpenRouterCatalog } from "../src/catalog.js";
import { ResourceStore } from "../src/store.js";

test("catalog discoveries are quarantined until qualified", async () => {
  const store = new ResourceStore(":memory:");
  const catalog = new OpenRouterCatalog("secret", async () => Response.json({
    data: [
      { id: "author/first:free", pricing: { prompt: "0", completion: "0" }, context_length: 1024 },
      { id: "author/paid", pricing: { prompt: "1", completion: "1" }, context_length: 1024 },
    ],
  }));

  assert.equal(await catalog.refresh(store, 100), 1);
  assert.equal((await store.listCatalogModels("openrouter"))[0]?.status, "quarantined");
  assert.equal((await store.listSelectableCatalogModels("openrouter")).length, 0);

  await store.qualifyCatalogModel("openrouter", "author/first:free", 101);
  assert.deepEqual(
    (await store.listSelectableCatalogModels("openrouter")).map((model) => model.modelId),
    ["author/first:free"],
  );
  store.close();
});

test("missing and newly non-zero models stop being selectable", async () => {
  const store = new ResourceStore(":memory:");
  await store.applyCatalogSnapshot("openrouter", [
    { modelId: "author/gone:free", zeroCost: true, metadata: {} },
    { modelId: "author/changed:free", zeroCost: true, metadata: {} },
  ], 100);
  await store.qualifyCatalogModel("openrouter", "author/gone:free", 101);
  await store.qualifyCatalogModel("openrouter", "author/changed:free", 101);

  await store.applyCatalogSnapshot("openrouter", [
    { modelId: "author/changed:free", zeroCost: false, metadata: {} },
    { modelId: "author/new:free", zeroCost: true, metadata: {} },
  ], 200);

  const models = await store.listCatalogModels("openrouter");
  assert.deepEqual(
    models.map((model) => [model.modelId, model.status]),
    [
      ["author/changed:free", "rejected"],
      ["author/gone:free", "unavailable"],
      ["author/new:free", "quarantined"],
    ],
  );
  assert.equal((await store.listSelectableCatalogModels("openrouter")).length, 0);
  store.close();
});
