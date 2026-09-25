import { defineConfig } from "oxlint";

export default defineConfig({
  jsPlugins: [
    {
      name: "rat-stack-debt",
      specifier: "./oxlint-plugin-debt-ledger.ts",
    },
  ],
  rules: { "rat-stack-debt/debt-ledger": "error" },
});
