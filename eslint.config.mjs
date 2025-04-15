import { defineConfig, globalIgnores } from "eslint/config";
import typescriptEslintEslintPlugin from "@typescript-eslint/eslint-plugin";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
});

export default defineConfig([globalIgnores(["examples/", "dist/", "**/*.js"]), {
    extends: compat.extends("plugin:prettier/recommended", "plugin:@typescript-eslint/recommended"),

    plugins: {
        "@typescript-eslint": typescriptEslintEslintPlugin,
    },

    languageOptions: {
        globals: {
            ...globals.node,
        },

        parser: tsParser,
        ecmaVersion: 5,
        sourceType: "module",

        parserOptions: {
            project: ["./tsconfig.json"],
            tsconfigRootDir: "/home/daniel/GitProjects/node-bacnet",
        },
    },

    rules: {
        "global-require": "off",
        "no-console": "off",
        "no-unused-vars": "off",
        "no-underscore-dangle": "off",
        "no-param-reassign": "off",
        "no-restricted-syntax": "off",
        camelcase: "off",
        "default-case": "off",
        "import/order": "off",
        "max-classes-per-file": "off",
        "no-plusplus": "off",
        "guard-for-in": "off",
        "no-bitwise": "off",
        "class-methods-use-this": "off",
        "no-continue": "off",
        "prefer-destructuring": "off",
        "no-use-before-define": "off",
        "no-restricted-globals": "off",
        radix: "off",
        "func-names": "off",
        "no-empty": "off",
        "no-await-in-loop": "off",
        "no-sparse-arrays": "off",
        "consistent-return": "off",
        "@typescript-eslint/explicit-function-return-type": "off",
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-unused-vars": "off",
        "@typescript-eslint/naming-convention": "off",
        "@typescript-eslint/dot-notation": "off",
        "@typescript-eslint/no-use-before-define": "off",
    },
    ignores: [
        "node_modules/",
        "dist/",
        "examples/",
        "coverage/",
        "**/*.js",
    ],
}]);