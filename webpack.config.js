const CopyWebpackPlugin = require("copy-webpack-plugin");
const path = require("node:path");
const TerserPlugin = require("terser-webpack-plugin");
const webpack = require("webpack");
const buildFolder = "build";

module.exports = (env, argv) => {
  const mode = argv.mode ?? "development";
  // `--env trace` (see `pnpm run build-trace`) builds the same add-on but with report tracing enabled:
  // every report run is written as JSON into <Downloads>/llm-composer-trace/, which needs the `downloads`
  // permission. It deliberately keeps the normal add-on identity (name and id), so installing it replaces
  // the regular add-on in place and keeps its settings, rather than adding a second one alongside it.
  const isTraceBuild = Boolean(env?.trace);
  const isProductionMode = mode === "production";
  return {
    mode: mode,
    // Source maps aid debugging in development but should not ship in the packaged .xpi
    // (they dwarf the minified bundles), so emit them only for non-production builds.
    devtool: isProductionMode ? false : "source-map",
    entry: {
      options: "./src/options.ts",
      background: "./src/background.ts",
      reports: "./src/reports.ts",
      organiseConfirm: "./src/organiseConfirm.ts",
    },
    output: {
      path: path.resolve(__dirname, buildFolder),
      filename: "[name].js",
      clean: isProductionMode,
    },
    module: {
      rules: [
        {
          // Transpile-only (no type-checking — that's the separate `tsc --noEmit` step in `build`).
          test: /\.ts$/,
          loader: "esbuild-loader",
          options: {
            // Match tsconfig's target so esbuild's downlevelling agrees with the type-checker.
            target: "es2022",
          },
          exclude: [/node_modules/, path.resolve(__dirname, "src/__tests__")],
        },
      ],
    },
    resolve: {
      extensions: [".ts", ".js"],
    },
    plugins: [
      // Compile-time switch read by src/reportTrace.ts; `false` lets Terser drop all tracing code.
      new webpack.DefinePlugin({ __TRACE_BUILD__: JSON.stringify(isTraceBuild) }),
      new CopyWebpackPlugin({
        patterns: [
          {
            from: path.resolve(__dirname, "icons"),
            to: path.resolve(__dirname, `${buildFolder}/icons`),
            globOptions: {
              ignore: ["**/original.png"],
            },
          },
          {
            from: path.resolve(__dirname, "public"),
            to: path.resolve(__dirname, `${buildFolder}/public`),
          },
          {
            from: path.resolve(__dirname, "manifest.json"),
            to: path.resolve(__dirname, buildFolder),
            transform(input) {
              const content = input.toString();
              // adjust relative paths in packaged manifest.json
              let newContent = content.replace(new RegExp(`(./)?${buildFolder}/`, "g"), "");
              if (isProductionMode) {
                // remove "dev" suffixes in manifest.json for production build
                newContent = newContent
                  .replaceAll(" (dev)", "")
                  .replace("llm-thunderbird-dev@tngtech.com", "llm-thunderbird@tngtech.com");
              }
              if (isTraceBuild) {
                // Only the tracing build may write files; keep the permission out of every other build.
                const manifest = JSON.parse(newContent);
                manifest.permissions = [...new Set([...manifest.permissions, "downloads"])];
                newContent = JSON.stringify(manifest, null, 2);
              }
              return newContent;
            },
          },
        ],
      }),
    ],
    optimization: {
      minimize: isProductionMode,
      minimizer: [
        new TerserPlugin({
          terserOptions: {
            compress: {
              // The tracing build keeps console output so the live console can be correlated with the traces.
              drop_console: isTraceBuild ? false : ["log", "info"],
            },
          },
        }),
      ],
    },
  };
};
