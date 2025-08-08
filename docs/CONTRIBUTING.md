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
- Browse to this repo and select the [manifest.json](../manifest.json)
- To reload the changes, click on the "Reload" button in the LLM Support tab.

Adding the plugin via the top-level [manifest.json](../manifest.json) will add the plugin with "(dev)" suffixes where
necessary,
in order to not interfere with a production version of the plugin.
This means you can run both, the most recent production version of the plugin alongside the dev-version you are
currently working on.

> [!IMPORTANT]
> If you want to use the plugin's shortcuts, change the ones for the production LLM to something else,
> since the dev-version will often reset the shortcuts.
> Using the same shortcuts for both will result in non-deterministic behavior. 

Please ensure that the dev-production separation still works when adding new functionality.
In particular, when adding new top-level buttons, make them distinguishable for dev and production versions
(see [webpack-config](../webpack.config.js) to see how this is currently handled for the manifest.json).

### Build the plugin locally

- Build the addon package:
  ```shell
  npm ship
  ```
- Start Thunderbird.
- Go to Hamburger Menu -> Add-ons and Themes.
- Click on the settings symbol -> Install Add-ons from file
- Browse to this repo and select [llm-thunderbird.xpi](../llm-thunderbird.xpi)

## Useful links

- [Thunderbird Add-On Documentation](https://developer.thunderbird.net/add-ons/about-add-ons)
- [Thunderbird Extension API](https://webextension-api.thunderbird.net/en/stable/)
- [Example extensions (source)](https://github.com/thunderbird/sample-extensions)

## Ship new release

See [How to create a new release](./create_new_release.md)

## Test Emails

These emails can be used to test the plugin (you can also create your own, but copying these is faster). Send around
the 2-3 emails between the two email addresses and then reply using the given prompt to test the plugin. One
conversation is extremely informal, the second one is extremely formal. This will allow to test the plugin ability to
adapt to the register of the previous emails.

### English Informal Conversation

#### Mailer Starting Mail

```text
Hi,
so about the barbeque on saturday, start at 11? Bring some beer ;)

Cheers,
John
```

#### Thunderbird Reply 1

```text
Sure, what do you prefer, Weiß or Pilz?

Cheers,
<your first name>
```

#### Mailer Reply

```text
Bring a bit of both, also some Helles would be nice.

Cheers
John
```

#### Thunderbird Prompt

```text
ok, what about wine?
```

### English Formal Conversation

#### Thunderbird Starting Mail

```text
Dear Professor John Doe,

I am writing to extend an esteemed invitation to participate in a
symposium of paramount significance, titled "Software Engineering in the
20th Century: What Went Wrong," to be held on June, 6th at the
Motorworld in Munich. This academic gathering aims to convene
distinguished experts in the field of software engineering to engage in
a profound examination of the triumphs and tribulations that have shaped
the discipline over the past century.

As a renowned authority in the realm of software engineering, your
presence at this symposium would be a valuable addition to the esteemed
gathering of scholars, researchers, and industry leaders. Your
contributions to the field, as evident in your seminal works on
engineering of operating systems, have had a profound impact on the
development of software engineering principles and practices. Your
unique perspective and insights would undoubtedly enrich the discussions
and debates that will unfold during the symposium.

The symposium "Software Engineering in the 20th Century: What Went
Wrong" seeks to provide a platform for introspection and critical
analysis of the software engineering discipline, with a focus on the
challenges, pitfalls, and lessons learned from the past century. The
event will feature keynote addresses, panel discussions, and technical
sessions, all designed to facilitate a comprehensive exploration of the
subject matter.

Some of the key themes and topics that will be addressed during the
symposium include:

* The evolution of software engineering methodologies and their impact
  on project outcomes
* The role of technological advancements in shaping software development
  practices
* The human factor: examining the social and psychological aspects of
  software engineering
* Case studies of notable successes and failures in software engineering
  projects
* The future of software engineering: lessons learned and emerging trends

As a distinguished guest, you will have the opportunity to share your
expertise and engage in thought-provoking discussions with fellow
experts, thereby contributing to the advancement of the field. Your
participation will not only enhance the intellectual rigor of the
symposium but also provide a unique opportunity for knowledge sharing
and collaboration.

The symposium will be held at the Motorworld in Munich, a
state-of-the-art facility equipped with cutting-edge technology and
amenities. A detailed program schedule, including the list of speakers,
panelists, and technical sessions, will be made available to you upon
registration.

To confirm your participation, please respond to this email by May, 4th.
A limited number of travel grants are available for participants who
require financial assistance; please indicate your interest in the grant
when responding to this invitation.

We look forward to the privilege of hosting you at the symposium and
benefiting from your invaluable insights. Your contribution to the
discourse will undoubtedly have a lasting impact on the software
engineering community.

Please do not hesitate to contact me if you require any additional
information or clarification.

Sincerely,
<your name>
```

#### Mailer Reply

```text
Dear <your name>,

I am honored to accept your esteemed invitation to participate in the symposium "Software Engineering in the 20th Century: What Went Wrong" to be held on June 6th at the Motorworld in Munich. I am delighted to contribute to this academic gathering of distinguished experts in the field of software engineering.

Furthermore, I would like to express my interest in holding a seminar during the symposium, focusing on the development of Windows 95 and 98. I believe that exploring the triumphs and tribulations of these iconic operating systems would provide valuable insights into the evolution of software engineering methodologies and their impact on project outcomes.

I am confident that my expertise in this area would enrich the discussions and debates during the symposium, and I look forward to sharing my knowledge with fellow experts. I would be grateful if you could provide me with more information on the seminar format, duration, and any specific requirements.

Thank you for extending this invitation, and I am excited to be a part of this esteemed gathering. I will respond by May 4th to confirm my participation and indicate my interest in the travel grant.

Please do not hesitate to contact me if you require any additional information or clarification.

Sincerely,
Prof. John Doe
```

#### Thunderbird Prompt

```text
cool
```
