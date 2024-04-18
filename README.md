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

# Installation

`lms` is shipped with [LM Studio](https://lmstudio.ai/). To set it up:

#### macOS / Linux

- **Zsh**

```bash
echo 'export PATH="$HOME/.cache/lmstudio/bin:$PATH"' >> ~/.zshrc
```

- **Bash**

```bash
echo 'export PATH="$HOME/.cache/lmstudio/bin:$PATH"' >> ~/.bashrc
```

> Not sure which shell you're using? Pop open your terminal and run `echo $SHELL` to find out. `/bin/zsh` means you're using Zsh, `/bin/bash` means you're using Bash.

#### Windows

- `lms.exe` should already be in your PATH after installation. Test it by running `lms version` in powershell or cmd.

# Usage

You can use `lms --help` to see a list of all available subcommands. For specific details about each subcommand, use `lms <subcommand> --help`.

Here are some frequently used commands:

- `lms status` - To check the status of LM Studio.
- `lms server start` - To start the local API server.
- `lms server stop` - To stop the local API server.
- `lms ls` - To list all downloaded models.
- `lms ps` - To list all loaded models available for inferencing.

Please note that most commands, except those controlling the server, internally use [lmstudio.js](https://github.com/lmstudio-ai/lmstudio.js). Therefore, ensure the server is running before utilizing these commands. You can start the server using `lms server start`.
