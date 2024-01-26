# LLM powered E-Mail writing in Thunderbird

A Thunderbird extension enabling LLM support while writing E-Mails.

It uses [llm-ls](https://github.com/huggingface/llm-ls) as a backend.

## Useful links

* [Thunderbird Add-On Documentation](https://developer.thunderbird.net/add-ons/about-add-ons)
* [Thunderbird Extension API](https://webextension-api.thunderbird.net/en/stable/)
* [Example extensions (source)](https://github.com/thunderbird/sample-extensions)
* [llm-ls](https://github.com/huggingface/llm-ls)
* [neovim plugin](https://github.com/huggingface/llm.nvim) using llm-ls

## Contributing

### Setup

The following tools are needed:
* Thunderbird
* npm

To install all dependencies, run
```shell
npm ci
```

### Test add-on

* "Start" the addon
  ```shell
  npm start
  ```
  This will recompile the typescript files automatically if they change.
  However, Thunderbird will not detect these changes unless the add-on is reloaded.
* Start Thunderbird
* Go to Menu -> Add-ons
* Click on the settings symbol -> Debug Add-ons -> Load Temporary Add-on...
* Browse to this repo and select the [manifest.json](./manifest.json)
