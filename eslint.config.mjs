import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Data-loading effects intentionally update local request state. The
      // asynchronous work is scoped by stable controller/network identifiers.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  globalIgnores([".next/**", "coverage/**", "node_modules/**"]),
]);
