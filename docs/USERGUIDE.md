# LLM Composer — User Guide

A concise guide to the four features of the LLM Composer Thunderbird extension:
**Compose**, **Summarize**, **Organise Folder**, and **Create Report**.

For installation and first-time setup, see the [README](../README.md).

## Contents

- [Where the features live](#where-the-features-live)
- [Compose an email](#compose-an-email)
- [Summarize a conversation](#summarize-a-conversation)
- [Organise a folder](#organise-a-folder)
- [Create a report](#create-a-report)
- [Settings reference](#settings-reference)

## Where the features live

| Feature | How to reach it |
| --- | --- |
| Compose | While writing an email: `Ctrl+Alt+L`, or the **LLM Composer** button / menu in the compose window |
| Summarize | While writing a reply: `Ctrl+Alt+K`, or the compose-window menu |
| Cancel | While a request runs: `Ctrl+Alt+C` |
| Organise Folder | Main window: `Ctrl+Alt+O`, or the **LLM Composer** toolbar button → **Organise folder** |
| Create Report | Main window: `Ctrl+Alt+R`, or the **LLM Composer** toolbar button → **Create Report…** |

Shortcuts can be changed under **Add-ons Manager → Settings ⚙ → Manage Extension Shortcuts**.

Before anything works, configure the LLM endpoint on the options page and grant host
access (see [README → Configure plugin](../README.md#configure-plugin)).

---

## Compose an email

Turn a short instruction into a full email draft.

1. Open a new email (or a reply) in the composer.
2. Type a brief prompt in the body, e.g. *"Ask Alice to reschedule Thursday's call to Friday."*
3. Press `Ctrl+Alt+L`.

The extension gathers context — your instruction, the reply quote (if any), and
optionally your recent sent mail to the same recipient — asks the LLM to write the
email, and replaces the body with the result. Your signature and any quoted reply are
re-appended. A subject is generated when the field is empty.

**Tips**

- Enable *Use last few mails to same recipient as context* in settings so the LLM
  matches your usual tone (formal vs. informal) with that person.
- The tone/format is guided by the **LLM Context** setting — edit it to change how
  drafts are structured.
- Press `Ctrl+Alt+C` to cancel a request that is taking too long.
- Only **plain-text** composing is fully supported.

---

## Summarize a conversation

Condense a long reply thread into a short summary.

1. Open a **reply** to a conversation (so the quoted thread is present).
2. Press `Ctrl+Alt+K`.

The quoted conversation is sent to the LLM and the summary is written into the composer.

---

## Organise a folder

Let the LLM sort the messages in the current folder into folders you define.

### One-time setup

On the options page, under **Organise Folder**, add one **rule** per destination folder:

- **Folder path** — e.g. `/INBOX/Work` (use **Show available folder paths** to list and
  copy the exact paths from your mailbox).
- **Description for the LLM** — free text telling the model what belongs there,
  e.g. *"Invoices, receipts and billing."*

Emails that don't clearly match any rule are left where they are.

### Running it

1. Select the folder you want to sort in the main window.
2. Press `Ctrl+Alt+O`, or click the **LLM Composer** toolbar button → **Organise folder**.

Messages are classified and moved in chunks, so progress is durable even if you stop
early. While it runs, the toolbar entry shows a **percentage**; click it (or the button)
to cancel — you'll still get a summary of what was moved so far.

### Confirm moves before applying

Controlled by the *Confirm moves before applying* setting:

- **On** (default) — a window lists each email with a dropdown to pick (or override) its
  destination. Nothing moves until you click **OK**.
- **Off** — emails are moved automatically as they are classified.

---

## Create a report

Ask a question about your mailbox and let the LLM search your messages agentically and
write a report.

1. Press `Ctrl+Alt+R`, or click the **LLM Composer** toolbar button → **Create Report…**, to open the report window.
2. Set the **scope**:
   - **Days in the past** — how far back to search.
   - **All folders** ↔ **Single folder** toggle; when *Single folder* is on, use the
     picker to choose which one (defaults to the current folder).
3. Type your request, e.g.
   *"A to-do list of open items addressed to me"* or
   *"How long Alice took to reply over the last 120 days."*
4. Press the **send** button (or `Enter`).

The LLM searches message metadata first and reads full message bodies only as needed,
keeping token use in check. A live counter shows LLM/tool calls while it works; press
**Stop** to abort.

**After a report is generated**

- **Linked emails** — the report cites the emails behind its statements as inline chips.
  Click **↗** on a chip to open that email in a tab, or **↩** to start a reply to it.
  (The links work within the current Thunderbird session.)
- **Refine** — type a follow-up instruction and send again; the report continues the
  same conversation (e.g. *"group these by sender"*).
- **New report** — discards the conversation and starts fresh.
- **Copy**, or save as **.txt** / **.md** — exported/copied text is plain text with the
  email links flattened to their labels (the citations are only clickable inside the report window).

**Saved prompts** — enter a name and click the **save** icon to store a report request
for reuse; pick it later from the **Saved prompts…** dropdown, or delete it with the trash icon.

---

## Settings reference

Open the options page: **Hamburger Menu → Add-ons and Themes → LLM Composer → Options**.

### LLM API Settings

| Setting | Meaning |
| --- | --- |
| **URL** | The OpenAI-compatible chat-completions endpoint. **Grant access** authorises the extension to reach this host (required). |
| **Api token** | Bearer token; leave empty for public endpoints. |
| **Request timeout (seconds)** | Abort requests after this long. `0`/empty = no timeout. |

### Context

| Setting | Meaning |
| --- | --- |
| **LLM Context** | Instructions that shape how composed emails are written (tone, format). |
| **Use last few mails to same recipient as context** | Feeds recent sent mail so drafts match your style with that person. |

### Response

| Setting | Meaning |
| --- | --- |
| **Remove `<think>` tag** | Strips `<think>…</think>` reasoning blocks from the output (on by default). |

### Organise Folder

Define **folder rules** (path + description) and choose whether to
**Confirm moves before applying**. See [Organise a folder](#organise-a-folder).

### Reports

| Setting | Meaning |
| --- | --- |
| **Default days in the past** | Prefilled search window in the report window. |
| **Max search results per query** | Cap on messages returned by one search. Lower = fewer tokens. |
| **Max agentic steps** | Upper bound on tool-calling iterations per report. Raise for more complex reports. |
| **Max message bodies per report** | How many full email bodies one report may read. |
| **Max total body characters per report** | Combined character ceiling across all bodies read; the main knob for predictable token use. |

### Model settings

| Setting | Meaning |
| --- | --- |
| **Context window** | Token budget used when trimming context. |
| **Other options (json)** | Extra request parameters (e.g. `{"model": "…", "temperature": 0.7}`). Use **Query available models** to list the endpoint's models and insert one. |
