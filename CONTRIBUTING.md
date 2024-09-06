# Contributing

## Setup

### Requirements

- npm
- (Windows): 7zip (its installation folder, usually "C:\Program Files\7-Zip", needs to be added to the PATH environment variable)

### Install dependencies

In the project root run
```shell
npm ci
```

## Test the Plugin

- "Start" the addon:
  ```shell
  npm start
  ```
  this will recompile the typescript files automatically if they change.
- Start Thunderbird.
- Go to Hamburger Menu -> Add-ons and Themes.
- Click on the settings symbol -> Debug Add-ons -> Load Temporary Add-on...
- Browse to this repo and select the [manifest.json](./manifest.json)
- To reload the changes, click on the "Reload" button in the LLM Support tab.

Adding the plugin via the top-level [manifest.json](./manifest.json) will add the plugin with "(dev)" suffixes where
necessary,
in order to not interfere with a production version of the plugin.
This means you can run both, the most recent production version of the plugin alongside the dev-version you are
currently working on.
Please ensure that this still works when adding new functionality.
In particular, when adding new top-level buttons, make them distinguishable for dev and production versions
(see [webpack-config](./webpack.config.js) to see how this is currently handled for the manifest.json).

### Build the plugin locally

- Build the addon package:
  ```shell
  npm ship
  ```
- Start Thunderbird.
- Go to Hamburger Menu -> Add-ons and Themes.
- Click on the settings symbol -> Install Add-ons from file
- Browse to this repo and select [llm-thunderbird.xpi](llm-thunderbird.xpi)

## Useful links

- [Thunderbird Add-On Documentation](https://developer.thunderbird.net/add-ons/about-add-ons)
- [Thunderbird Extension API](https://webextension-api.thunderbird.net/en/stable/)
- [Example extensions (source)](https://github.com/thunderbird/sample-extensions)
