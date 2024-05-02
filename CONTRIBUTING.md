# Contributing

`lms` is LM Studio’s command line utility tool. It is an open-source project under the MIT license. We welcome community contributions. There are many ways to help, from writing tutorials or blog posts, improving the documentation, submitting bug reports and feature requests or contributing code which can be incorporated into `lms` itself.

## Before you start

If you are planning to add a feature or fix a bug, please open an issue first to discuss it. This is mainly to avoid duplicate work and to make sure that your contribution is in line with the project's goals. The LM Studio team is available to chat in the `#dev-chat` channel within the [LM Studio Discord server](https://discord.gg/pwQWNhmQTY).

## How to make code contributions

_Developing `lms` requires Node.js 18.6.0_

1. Fork this repository
2. Clone your fork: `git clone git@github.com:lmstudio-ai/lmstudio-cli.git` onto your local development machine
3. Run `npm install` to install the dependencies
4. Run `npm run watch` to start the development server
5. Go to `dist` folder and run `node ./index.js <subcommand>` to test your changes

## Q&A

- **How does `lms` communicate with LM Studio**

  For the most part, `lms` communicates with LM Studio through the `lmstudio.js` SDK. You can find the source code for the SDK [here](https://github.com/lmstudio-ai/lmstudio.js/tree/main). `lmstudio.js` is in pre-release public alpha and it does not yet have a stable API.

  There are some commands (such as `lms server start` or `lms server stop`) that need to interact with LM Studio separately from the API server state. In such cases, `lms` uses an internal file system based “communication” scheme. You can find the [related code here](https://github.com/lmstudio-ai/lmstudio-cli/blob/main/src/subcommands/server.ts). Note, if you are developing your own software, please do not rely on this API as it is subject to change. Relying on this API is guaranteed to cause sadness.

- **How are the lms binaries built**

  As you may have noticed, the `lms` command line tool shipped with LM Studio is a single binary file.

  The binary is [built in our lmstudio.js mono-repo](https://github.com/lmstudio-ai/lmstudio.js/tree/main/publish/cli). This is done so that we can manage the versions of the `lms` command line tool and the `lmstudio.js` library together.

## Questions

If you have any other questions, feel free to join the [LM Studio Discord server](https://discord.gg/pwQWNhmQTY) and ask in the `#dev-chat` channel.

## Is the LM Studio team hiring?

Yes, yes we are. Please see our careers page: https://lmstudio.ai/careers.
