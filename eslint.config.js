// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*", "server/**", "web/**", "packages/**", "watch-app/**"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      // System dialogs ignore the app's theme: use appAlert() / ConfirmDialog (src/components).
      "no-restricted-syntax": ["error", {
        selector: "MemberExpression[object.name='Alert'][property.name=/^(alert|prompt)$/]",
        message: "Use appAlert() or ConfirmDialog from @/components instead of the system Alert.",
      }],
    },
  },
]);
