# Contributing to `lms`

First off, thank you for considering contributing to our open source projects! 👾❤️

`lms` is LM Studio’s command line utility tool. It is an open-source project under the MIT license. We welcome community contributions.

There are many ways to help, from writing tutorials or blog posts, improving the documentation, submitting bug reports and feature requests or contributing code which can be incorporated into `lms` itself.

## Communication

- **The best way to communicate with the team is to open an issue in this repository**
- For bug reports, include steps to reproduce, expected behavior, and actual behavior
- For feature requests, explain the use case and benefits clearly

## Before You Contribute

- **If you find an existing issue you'd like to work on, please comment on it first and tag the team**
- This allows us to provide guidance and ensures your time is well spent
- **We discourage drive-by feature PRs** without prior discussion - we want to make sure your efforts align with our roadmap and won't go to waste

## Creating Good Pull Requests

### Keep PRs Small and Focused

- Address one concern per PR
- Smaller PRs are easier to review and more likely to be merged quickly

### Write Thoughtful PR Descriptions

- Clearly explain what the PR does and why
- When applicable, show before/after states or screenshots
- Include any relevant context for reviewers
- Reference the issue(s) your PR addresses with GitHub keywords (Fixes #123, Resolves #456)

### Quality Expectations

- Follow existing code style and patterns
- Include tests for new functionality
- Ensure all tests pass
- Update documentation as needed

## Code Review Process

- Maintainers will review your PR as soon as possible
- We may request changes or clarification
- Once approved, a maintainer will merge your contribution

## Contributor License Agreement (CLA)

- We require all contributors to sign a Contributor License Agreement (CLA)
- For first-time contributors, a bot will automatically comment on your PR with instructions
- You'll need to accept the CLA before we can merge your contribution
- This is standard practice in open source and helps protect both contributors and the project

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
