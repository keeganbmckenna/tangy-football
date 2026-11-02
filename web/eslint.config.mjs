import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // React Compiler readiness rules (eslint-config-next 16): warnings, since the site doesn't use
    // the compiler. What they flag here is deliberate: browser-only state read after the first
    // render, toggles remembered across remounts in module variables, the live chart reading the clock.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/globals": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
  globalIgnores(["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
