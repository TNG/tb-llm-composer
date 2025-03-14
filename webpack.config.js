const CopyWebpackPlugin = require("copy-webpack-plugin");
const path = require("node:path");
const TerserPlugin = require("terser-webpack-plugin");
const buildFolder = "build";

module.exports = (env, argv) => {
  const mode = argv.mode ?? "development";
  const isProductionMode = mode === "production";
  return {
    mode: mode,
    devtool: "source-map",
    entry: {
      options: "./src/options.ts",
      background: "./src/background.ts",
    },
    output: {
      path: path.resolve(__dirname, buildFolder),
      filename: "[name].js",
      clean: isProductionMode,
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: "ts-loader",
          exclude: [/node_modules/, path.resolve(__dirname, "__tests__")],
        },
      ],
    },
    resolve: {
      extensions: [".ts", ".js"],
    },
    plugins: [
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
              drop_console: ["log", "info"],
            },
          },
        }),
      ],
    },
  };
};
