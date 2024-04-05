# LLM powered E-Mail writing in Thunderbird

A Thunderbird extension enabling LLM support while writing E-Mails.

## Requirements

The following tools are needed:

- Thunderbird
- npm
- (Windows): 7zip (its installation folder, usually "C:\Program Files\7-Zip", needs to be added to the PATH environment variable)

## Install the Plugin

- Clone the repository
- To install all dependencies, run
  ```shell
  npm ci
  ```

- Build the addon package:
  ```shell
  npm ship
  ```
- Start Thunderbird.
- Go to Hamburger Menu -> Add-ons and Themes.
- Click on the settings symbol -> Install Add-ons from file
- Browse to this repo and select [llm-thunderbird.xpi](llm-thunderbird.xpi)

## Configure plugin

Open the preference window of the plugin.
Specify the following things:

- URL: The URL to the endpoint of the LLM.
  If you don't have access to an LLM, try https://github.com/cheahjs/free-llm-api-resource
- Api token: Leave empty if public, otherwise obtain one.
