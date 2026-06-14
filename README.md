<p align="center">
  <br/>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://files.lmstudio.ai/lms-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="https://files.lmstudio.ai/lms-light.png">
    <img alt="lmstudio cli logo" src="https://files.lmstudio.ai/lms-light.png" width="180">
  </picture>
  <br/>
  <br/>
</p>

<p align="center"><bold><code>lms</code> - Command Line Tool for <a href="https://lmstudio.ai/">LM Studio</a></bold></p>
<p align="center">Built with <bold><code><a href="https://github.com/lmstudio-ai/lmstudio.js">lmstudio.js</a></code></bold></p>

# Installation

`lms` ships with [LM Studio](https://lmstudio.ai/) 0.2.22 and newer.

If you have trouble running the command, try running `npx lmstudio install-cli` to add it to path.

To check if the bootstrapping was successful, run the following in a **👉 new terminal window 👈**:

```shell
lms
```

# Usage

You can use `lms --help` to see a list of all available subcommands.

For details about each subcommand, run `lms <subcommand> --help`.

Here are some frequently used commands:

- `lms status` - To check the status of LM Studio.
- `lms server start` - To start the local API server.
- `lms server stop` - To stop the local API server.
- `lms ls` - To list all downloaded models.
  - `lms ls --json` - To list all downloaded models in machine-readable JSON format.
- `lms ps` - To list all loaded models available for inferencing.
  - `lms ps --json` - To list all loaded models available for inferencing in machine-readable JSON format.
- `lms load` - To load a model
  - `lms load <model path> -y` - To load a model with maximum GPU acceleration without confirmation
- `lms import <file path>` - To import a local model file into LM Studio.
- `lms unload <model identifier>` - To unload a model
  - `lms unload --all` - To unload all models
- `lms create` - To create a new project with LM Studio SDK
- `lms log stream` - To stream logs from LM Studio

## Import a model file

Use `lms import` when you already have a local model file, such as a `.gguf` file, and want LM Studio to manage it from the models folder.

```shell
lms import ~/Downloads/mistral-7b-instruct.Q4_K_M.gguf
```

By default, the command moves the file into LM Studio's models folder. Use one of the file-handling options when you want to keep the original file in place:

```shell
# Copy the file instead of moving it
lms import ~/Downloads/model.gguf --copy

# Create a hard link instead of moving or copying it
lms import ~/Downloads/model.gguf --hard-link

# Create a symbolic link instead of moving or copying it
lms import ~/Downloads/model.gguf --symbolic-link
```

If the file name does not include enough information to categorize the model, provide the repository manually:

```shell
lms import ~/Downloads/model.gguf --user-repo user/repo
```

For unattended usage, add `--yes` to approve prompts automatically. To preview the target action without changing files, use `--dry-run`:

```shell
lms import ~/Downloads/model.gguf --yes --dry-run
```

# Contributing

The CLI is part of the [lmstudio.js monorepo](https://github.com/lmstudio-ai/lmstudio.js) and cannot be built standalone.

## Building and Testing the CLI

```bash
# Clone and build the entire monorepo
git clone https://github.com/lmstudio-ai/lmstudio-js.git --recursive
cd lmstudio-js
npm install
npm run build

# Test your CLI changes
node publish/cli/dist/index.js <subcommand>
```

**Example:**

```bash
node publish/cli/dist/index.js --help
node publish/cli/dist/index.js status
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for more information.
