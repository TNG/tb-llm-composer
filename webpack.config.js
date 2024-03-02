const CopyWebpackPlugin = require('copy-webpack-plugin');
const path = require("path");
const buildFolder = "dist"

module.exports = {
  mode: "development",
  devtool: "source-map",
  entry: {
    options: "./src/options.ts",
    background: "./src/background.ts",
  },
  output: {
    path: path.resolve(__dirname, buildFolder),
    filename: "[name].js",
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: "ts-loader",
        exclude: /node_modules/,
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
          from: path.resolve(__dirname, 'icons'),
          to: path.resolve(__dirname, buildFolder + '/icons')
        },
      ],
    }),
  ],
};
