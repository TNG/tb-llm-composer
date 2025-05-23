# LLM powered E-Mail writing in Thunderbird

A Thunderbird extension enabling LLM support while writing E-Mails.

## Requirements

- Thunderbird >= 110.0

## Install the Plugin

- Download the latest release (the `*.xpi` file) from the [release page](https://github.com/TNG/thunderbird-llm-composer/releases)
- Start Thunderbird.
- Go to Hamburger Menu -> Add-ons and Themes.
- Click on the settings symbol -> Install Add-ons from file
- Select the downloaded xpi file

## Configure plugin

Open the preference window of the plugin.
Specify the following things:

- URL: The URL to the endpoint of the LLM.
  If you don't have access to an LLM, try https://github.com/cheahjs/free-llm-api-resource
- Api token: Leave empty if public, otherwise obtain one.

### Shortcuts

By default, the plugin, introduces the following shortcuts:
- `Ctrl+Alt+L`: to ask the LLM to compose a mail
- `Ctrl+Alt+K`: to ask the LLM to summarize the existing conversation

Shortcuts can be customized in
"Add-ons Manger" >> Settings ⚙ >> "Manage Extension Shortcuts"

## Contributing

See [Contributing](./CONTRIBUTING.md)

## License

This project is licensed under the Apache License 2.0. See the [LICENSE](LICENSE) file for details.
