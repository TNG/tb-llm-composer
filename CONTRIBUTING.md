# Contributing

First go through the [README](README.md)

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


## Useful links

- [Thunderbird Add-On Documentation](https://developer.thunderbird.net/add-ons/about-add-ons)
- [Thunderbird Extension API](https://webextension-api.thunderbird.net/en/stable/)
- [Example extensions (source)](https://github.com/thunderbird/sample-extensions)
