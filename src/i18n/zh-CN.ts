/**
 * Simplified Chinese (zh-CN) translations for the `lms` CLI.
 *
 * The English source string is the lookup key. Anything absent from this map — command names,
 * flag names, model identifiers, file paths, URLs, product names — deliberately stays in its
 * original form.
 *
 * Conventions (aligned with the official GUI localization in lmstudio-ai/localization):
 *   - Full-width Chinese punctuation （），。：；！？in prose; half-width kept inside technical tokens.
 *   - Ellipsis is three half-width dots (`...`), not `……`.
 *   - `token`, `LLM`, `MLX`, `GGUF`, `TTL`, `CORS`, `JSON`, `CI/CD`, `GPU`, `Hub`, `LM Link`
 *     and similar established abbreviations/product names stay in English.
 *   - `--flag`, `lms <command>`, paths and URLs are never translated; they are interpolated
 *     around, or quoted verbatim inside, the Chinese sentence.
 *
 * Keys must match the English source strings exactly; a key that drifts silently falls back to
 * English rather than producing a broken message.
 *
 * @public
 */
export const zhCN: Record<string, string> = {
  "Or visit the following URL directly:": "或直接访问以下地址：",
  'If you wish to connect to a remote LM Studio instance, specify the host here. Note that, in this case, lms will connect using client identifier "lms-cli-remote-<random chars>", which will not be a privileged client, and will restrict usage of functionalities such as "lms push".':
    '若要连接到远程 LM Studio 实例，请在此指定主机。注意：这种情况下 lms 将以客户端标识 "lms-cli-remote-<随机字符>" 连接，该标识不是特权客户端，并会限制 "lms push" 等功能的使用。',
  "Host should not include the protocol.": "主机地址不应包含协议前缀。",
  'You are using a development build of lms-cli. Privileged features such as "lms push" will not work.':
    '你正在使用 lms-cli 的开发版构建。"lms push" 等特权功能将不可用。',
  "Could not find the project folder. Please invoke this command in a folder with a manifest.json file.\n\n       To create an empty plugin, use the `lms create` command, or create a new plugin in LM Studio.":
    "找不到项目文件夹。请在包含 manifest.json 文件的文件夹中运行此命令。\n\n       若要创建空插件，请使用 `lms create` 命令，或在 LM Studio 中创建新插件。",
  "The level of logging to use": "要使用的日志级别",
  "Suppress all logging": "屏蔽所有日志输出",
  "Enable verbose logging": "启用详细日志",
  "Download will continue in the background.": "下载将在后台继续。",
  "Download canceled.": "下载已取消。",
  "Print the version of the CLI": "打印 CLI 版本信息",
  "Learn more:": "了解更多：",
  "Join our Discord:": "加入我们的 Discord：",
  "Local models": "本地模型",
  "Serve": "服务",
  "Remote Instances": "远程实例",
  "Runtime": "运行时",
  "Develop & Publish (Beta)": "开发与发布（测试版）",
  "Uploads the artifact in the current folder to LM Studio Hub":
    "将当前文件夹中的制品上传到 LM Studio Hub",
  "Description of the artifact. If provided, will overwrite the existing description.":
    "制品的描述。若提供，将覆盖已有描述。",
  "JSON string": "JSON 字符串",
  "When specified, the revision number will be written to the manifest.json file. This is useful if you want to keep track of the revision number in your source control.":
    "指定后，修订号将写入 manifest.json 文件。若希望在版本控制中跟踪修订号，这会很有用。",
  "When specified, the published artifact will be marked as private. This flag is only effective if the artifact did not exist before. (It will not change the visibility of an existing artifact.)":
    "指定后，发布的制品将标记为私有。此标志仅在制品此前不存在时生效。（不会改变已有制品的可见性。）",
  "Automatically approve all prompts.": "自动确认所有提示。",
  "This artifact was created without a username.": "该制品创建时未设置用户名。",
  "Aborting push.": "已中止推送。",
  "   Or install it with:": "   或使用以下命令安装：",
  "The following files will be pushed:": "以下文件将被推送：",
  "Clone an artifact from LM Studio Hub to a local folder":
    "将制品从 LM Studio Hub 克隆到本地文件夹",
  "The identifier for the artifact. Must be in the form of 'owner/name'.":
    "制品的标识符，必须为 'owner/name' 形式。",
  "The path to the folder to clone the resources into. If not provided, defaults to a new folder with the artifact name in the current working directory.":
    "克隆资源的目标文件夹路径。若未提供，则默认在当前工作目录下创建以制品命名的新文件夹。",
  "Finalizing download...": "正在完成下载...",
  "Prints the status of LM Studio": "打印 LM Studio 状态",
  "Search and download local models or Hub artifacts": "搜索并下载本地模型或 Hub 制品",
  'The model or Hub artifact to download, for example "openai/gpt-oss-20b" or "owner/my-skill". For a specific model quantization, append its name with "@", for example "qwen/qwen3.5-9b@q8_0". To download a model from Hugging Face directly, use its full URL.':
    '要下载的模型或 Hub 制品，例如 "openai/gpt-oss-20b" 或 "owner/my-skill"。若要指定特定量化版本，请在名称后加 "@"，例如 "qwen/qwen3.5-9b@q8_0"。若要直接从 Hugging Face 下载模型，请使用完整 URL。',
  'Restrict model resolution to MLX-compatible options. If any of "--mlx" or "--gguf" is specified, only matching formats will be considered. Otherwise only options supported by your system will be considered.':
    '将模型解析限制为 MLX 兼容选项。若指定了 "--mlx" 或 "--gguf" 中的任意一个，将只考虑匹配的格式；否则只考虑你的系统所支持的选项。',
  'Restrict model resolution to GGUF-compatible options. If any of "--mlx" or "--gguf" is specified, only matching formats will be considered. Otherwise only options supported by your system will be considered.':
    '将模型解析限制为 GGUF 兼容选项。若指定了 "--mlx" 或 "--gguf" 中的任意一个，将只考虑匹配的格式；否则只考虑你的系统所支持的选项。',
  "Automatically approve all prompts. Useful for scripting. If there are multiple staff picks matching the search term, the first one will be used. If there are multiple download options, the preselected option based on your hardware and preferences will be used.":
    "自动确认所有提示，便于脚本使用。若有多条精选匹配搜索词，将使用第一条；若有多个下载选项，将使用根据你的硬件和偏好预选的选项。",
  "Open variant selection before downloading. Useful if the default variant is already downloaded and you want to choose a different one.":
    "下载前打开变体选择。若默认变体已下载，而你想选择其他变体，此选项很有用。",
  "Multiple staff picks found. Automatically selecting the first one due to --yes.":
    "找到多条精选。由于指定了 --yes，将自动选择第一条。",
  "No exact match found. Please choose a model from the list below.":
    "未找到完全匹配项。请从下面的列表中选择模型。",
  "AutoFit can only be configured for LLM models.": "AutoFit 只能针对 LLM 模型配置。",
  "Speculative decoding can only be configured for LLM models.": "投机解码只能针对 LLM 模型配置。",
  "Load a model": "加载模型",
  "The model key to load. If not provided, enters an interactive mode to select a model.":
    "要加载的模型 key。若未提供，将进入交互模式选择模型。",
  "Import an engine configuration file. Use trusted files without secrets; contents are readable by users and clients with access to the model's configuration.":
    "导入引擎配置文件。请使用不含机密信息的可信文件；其内容对能够访问该模型配置的用户和客户端可见。",
  "Use ordinary LM Studio settings for this load.": "本次加载使用常规 LM Studio 设置。",
  "Set the engine's current working directory in config-file mode. Defaults to the saved directory or runtime temp, which is removed on unload.":
    "配置文件模式下设置引擎的工作目录。默认使用已保存的目录或运行时临时目录（卸载时会被删除）。",
  "Use the runtime temporary directory for this load.": "本次加载使用运行时临时目录。",
  "Automatically choose context length and model placement based on available resources, when supported by the connected backend.":
    "在所连接的后端支持时，根据可用资源自动选择上下文长度与模型放置位置。",
  'GPU offload ratio. Valid values: "off" (disable GPU), "max" (full offload), or a number between 0 and 1 (e.g., "0.5" for 50% offload). By default, LM Studio automatically determines the optimal offload ratio.':
    'GPU 卸载比例。可取值："off"（禁用 GPU）、"max"（完全卸载），或 0 到 1 之间的数字（例如 "0.5" 表示卸载 50%）。默认情况下，LM Studio 会自动确定最优卸载比例。',
  "The number of tokens to consider as context when generating text. If not provided, the default value will be used.":
    "生成文本时作为上下文考虑的 token 数量。若未提供，将使用默认值。",
  "Maximum number of predictions the model can run at a given time. The speed of each individual prediction may decrease with concurrency, but each prediction will start faster and higher total throughput can be achieved.":
    "模型同时可执行的最大预测数量。并发会降低单次预测的速度，但每次预测启动更快，且可获得更高的总吞吐量。",
  "TTL: If provided, when the model is not used for this number of seconds, it will be unloaded.":
    "TTL：若提供，模型在此秒数内未被使用时将被卸载。",
  "Enable load-time Draft MTP speculative decoding when supported by the model.":
    "在模型支持时启用加载时的 Draft MTP 投机解码。",
  "Disable load-time Draft MTP speculative decoding.": "禁用加载时的 Draft MTP 投机解码。",
  "Enable load-time Draft Simple speculative decoding using --speculative-draft-model.":
    "启用加载时的 Draft Simple 投机解码，需配合 --speculative-draft-model 使用。",
  "Draft model resource to use with --speculative-draft-simple.":
    "与 --speculative-draft-simple 搭配使用的草稿模型资源。",
  "Maximum number of draft tokens to generate per speculative decoding step. Requires --speculative-draft-simple or --speculative-draft-mtp.":
    "每次投机解码步骤生成的最大草稿 token 数。需要配合 --speculative-draft-simple 或 --speculative-draft-mtp 使用。",
  "Minimum draft length to consider for speculative decoding. Requires --speculative-draft-simple or --speculative-draft-mtp.":
    "投机解码采用的最小草稿长度。需要配合 --speculative-draft-simple 或 --speculative-draft-mtp 使用。",
  "Continue drafting while token probability is at or above this threshold. Requires --speculative-draft-simple or --speculative-draft-mtp.":
    "当 token 概率处于或高于此阈值时继续生成草稿。需要配合 --speculative-draft-simple 或 --speculative-draft-mtp 使用。",
  "Only load the model if the path provided matches the model exactly. Fails if the path provided does not match any model.":
    "仅当所提供路径与模型完全匹配时才加载。若路径不匹配任何模型则失败。",
  "Only use models available locally. Models provided via LM Link will be ignored.":
    "仅使用本地可用的模型。通过 LM Link 提供的模型将被忽略。",
  "The identifier to assign to the loaded model. The identifier can be used to refer to the model in the API.":
    "分配给已加载模型的标识符。可在 API 中用该标识符引用此模型。",
  "Calculate an estimate of the resources required to load the model. Does not load the model.":
    "仅计算加载该模型所需资源的预估值，不实际加载模型。",
  "Automatically approve all prompts. Useful for scripting. If there are multiple models matching the model key, the model will be loaded on the preferred device (if set), or the first matching model will be loaded.":
    "自动确认所有提示，便于脚本使用。若有多个模型匹配该模型 key，将在已设置的首选设备上加载，否则加载第一个匹配的模型。",
  "! Multiple models match the provided model key. Please select one.":
    "! 有多个模型匹配所提供的模型 key，请选择一个。",
  "Load cancelled.": "已取消加载。",
  "Using a configuration file; LM Studio load-tuning settings are ignored.":
    "正在使用配置文件；LM Studio 的加载调优设置将被忽略。",
  "Authenticate with LM Studio": "对 LM Studio 进行身份验证",
  "Check the current authentication status without logging in.": "不登录，仅检查当前身份验证状态。",
  "Log in as a compute device using a token from LM Studio.":
    "使用 LM Studio 提供的令牌以计算设备身份登录。",
  "Authenticate using pre-authenticated keys. This is useful for CI/CD environments. You must also provide the --key-id, --public-key, and --private-key flags.":
    "使用预认证密钥进行身份验证。适用于 CI/CD 环境。同时必须提供 --key-id、--public-key 和 --private-key 标志。",
  "The key ID to use for authentication. You should supply this if and only if you are using --with-pre-authenticated-keys.":
    "身份验证所用的 key ID。仅在使用 --with-pre-authenticated-keys 时才需要提供此项。",
  "The public key to use for authentication. You should supply this if and only if you are using --with-pre-authenticated-keys.":
    "身份验证所用的公钥。仅在使用 --with-pre-authenticated-keys 时才需要提供此项。",
  "The private key to use for authentication. You should supply this if and only if you are using --with-pre-authenticated-keys.":
    "身份验证所用的私钥。仅在使用 --with-pre-authenticated-keys 时才需要提供此项。",
  "The --status flag cannot be used with --with-pre-authenticated-keys or --as-compute-device.":
    "--status 标志不能与 --with-pre-authenticated-keys 或 --as-compute-device 一起使用。",
  "The --with-pre-authenticated-keys and --as-compute-device flags cannot be used together.":
    "--with-pre-authenticated-keys 与 --as-compute-device 标志不能同时使用。",
  "You must provide --key-id, --public-key, and --private-key when using --with-pre-authenticated-keys.":
    "使用 --with-pre-authenticated-keys 时，必须提供 --key-id、--public-key 和 --private-key。",
  "You must not provide --key-id, --public-key, or --private-key when not using --with-pre-authenticated-keys.":
    "未使用 --with-pre-authenticated-keys 时，不得提供 --key-id、--public-key 或 --private-key。",
  "Authentication successful.": "身份验证成功。",
  "Check the current authentication status": "检查当前身份验证状态",
  "Import a model file into LM Studio": "将模型文件导入 LM Studio",
  "Path to the model file to import": "要导入的模型文件路径",
  "Automatically approve all prompts. Will also attempt to automatically resolve the user and repository from the file name.":
    "自动确认所有提示，并会尝试根据文件名自动解析用户与仓库。",
  'Manually provide the user and repository in the format "user/repo". Specifying this will skip prompts about how to categorize the model file.':
    '以 "user/repo" 格式手动提供用户与仓库。指定此项将跳过关于模型文件归类的提示。',
  "Copy the file instead of moving it. This is useful when you want to keep the original file in place.":
    "复制文件而非移动。适用于希望保留原始文件的场景。",
  "Create a hard link instead of moving or copying the file. This is useful when you want to keep the original file in place.":
    "创建硬链接而非移动或复制文件。适用于希望保留原始文件的场景。",
  "Create a symbolic link instead of moving or copying the file. This is useful when you want to keep the original file in place.":
    "创建符号链接而非移动或复制文件。适用于希望保留原始文件的场景。",
  "Do not actually perform the import, just show what would be done.":
    "不实际执行导入，仅显示将要进行的操作。",
  "The file name does not look like a model file. This may not work.":
    "文件名看起来不像模型文件，此操作可能无法生效。",
  "Due to Windows usually require administrator privileges to create symbolic links, this operation may fail.":
    "由于 Windows 通常需要管理员权限才能创建符号链接，此操作可能会失败。",
  "You can try creating hard links instead. (Use the --hard-link flag)":
    "可以改为尝试创建硬链接。（使用 --hard-link 标志）",
  "Warning about move suppressed by the --yes flag.": "由于 --yes 标志，移动相关的警告已被忽略。",
  "Attempting to find the model on Hugging Face...": "正在尝试在 Hugging Face 上查找模型...",
  "Cannot find the model on Hugging Face, use default naming...":
    "在 Hugging Face 上找不到该模型，将使用默认命名...",
  "Searching for the model on Hugging Face using the file name...":
    "正在使用文件名在 Hugging Face 上搜索模型...",
  "Found the following repositories on Hugging Face containing this file:":
    "在 Hugging Face 上找到包含此文件的以下仓库：",
  "Please specify the user and repository manually.": "请手动指定用户与仓库。",
  "Failed to parse Hugging Face search result": "解析 Hugging Face 搜索结果失败",
  "Unload a model": "卸载模型",
  "The identifier of the model to unload. If not provided and exactly one model is loaded, it will be unloaded automatically. Otherwise, you will be prompted to select a model interactively from a list.":
    "要卸载的模型标识符。若未提供且仅加载了一个模型，将自动卸载该模型；否则会提示你从列表中交互选择模型。",
  "Unload all models": "卸载所有模型",
  "No models to unload.": "没有可卸载的模型。",
  "Set or get experiment flags": "设置或读取实验性标志",
  "Outputs the result in JSON format to stdout.": "以 JSON 格式将结果输出到标准输出。",
  "The flag to set or get": "要设置或读取的标志",
  "No experiment flags are set.": "未设置任何实验性标志。",
  "Enabled experiment flags:": "已启用的实验性标志：",
  "Stream logs from LM Studio": "从 LM Studio 流式输出日志",
  "Outputs in JSON format, separated by newline": "以 JSON 格式输出，每行一条",
  "Print prediction stats if available": "打印预测统计信息（如有）",
  "Source of logs: 'model', 'server', or 'runtime'": "日志来源：'model'、'server' 或 'runtime'",
  "Filter for model source: 'input', 'output'": "模型来源的过滤条件：'input'、'output'",
  "--stats can only be used with --source model": "--stats 只能与 --source model 一起使用",
  "--filter can only be used with --source model": "--filter 只能与 --source model 一起使用",
  "--filter cannot be empty": "--filter 不能为空",
  "--filter values must be 'input', 'output', or 'input,output'":
    "--filter 的取值必须是 'input'、'output' 或 'input,output'",
  "Streaming logs from LM Studio\n": "正在从 LM Studio 流式输出日志\n",
  "input:": "输入：",
  "output:": "输出：",
  "No stats available": "无可用统计信息",
  "Log incoming and outgoing messages": "记录收发的消息",
  "Create a new project with scaffolding": "使用脚手架创建新项目",
  "The scaffold to use": "要使用的脚手架",
  "Fetching scaffolds list...": "正在获取脚手架列表...",
  "Please update LM Studio from https://lmstudio.ai": "请通过 https://lmstudio.ai 更新 LM Studio",
  "Checking requirements...": "正在检查环境要求...",
  "Node.js is required to create this project.": "创建此项目需要 Node.js。",
  "Please install Node.js from https://nodejs.org/": "请从 https://nodejs.org/ 安装 Node.js",
  "npm is required to create this project.": "创建此项目需要 npm。",
  "Downloading necessary files...": "正在下载必要文件...",
  "Extracting files...": "正在解压文件...",
  "Initializing project...": "正在初始化项目...",
  "Installing dependencies...": "正在安装依赖...",
  "Finalizing...": "正在收尾...",
  "\nProject initialized.": "\n项目已初始化。",
  "Prints the version of the CLI": "打印 CLI 版本信息",
  "Prints the version in JSON format": "以 JSON 格式打印版本信息",
  "List the models available on disk": "列出磁盘上可用的模型",
  "Show variants for the provided model key": "显示所提供模型 key 的变体",
  "Show only LLM models": "仅显示 LLM 模型",
  "Show only embedding models": "仅显示嵌入模型",
  "[Deprecated] Show detailed view with grouping": "[已弃用] 显示带分组的详细视图",
  "Show variants for all models": "显示所有模型的变体",
  "Outputs in JSON format to stdout": "以 JSON 格式输出到标准输出",
  "List the models currently loaded in memory": "列出当前已加载到内存的模型",
  "Starts the local server": "启动本地服务器",
  "Port to run the server on. If not provided, the server will run on the same port as the last time it was started.":
    "服务器运行的端口。若未提供，将沿用上次启动时的端口。",
  'Network address to bind the server to. Use "0.0.0.0" to accept connections from the local network, or "127.0.0.1" (default) for localhost only. Can also be set via the LMS_SERVER_HOST environment variable.':
    '服务器绑定的网络地址。使用 "0.0.0.0" 可接受来自局域网的连接，使用 "127.0.0.1"（默认）则仅限本机访问。也可通过 LMS_SERVER_HOST 环境变量设置。',
  "Enable CORS on the server. Allows any website you visit to access the server. This is required if you are developing a web application.":
    "在服务器上启用 CORS，允许你访问的任何网站访问该服务器。开发 Web 应用时需要此项。",
  "CORS is enabled. This means any website you visit can use the LM Studio server.":
    "已启用 CORS，这意味着你访问的任何网站都可以使用 LM Studio 服务器。",
  "Server will accept connections from the network. Only use this if you know what you are doing!":
    "服务器将接受来自网络的连接。请确认你清楚其含义再使用！",
  "Failed to verify the server is running. Please try to use another port.":
    "未能确认服务器正在运行，请尝试更换端口。",
  "Stops the local server": "停止本地服务器",
  "Displays the status of the local server": "显示本地服务器状态",
  "Outputs the status in JSON format to stdout.": "以 JSON 格式将状态输出到标准输出。",
  "Commands for managing the local server": "管理本地服务器的命令",
  "Log out of LM Studio": "退出 LM Studio 登录",
  "You were already logged out.": "你此前已退出登录。",
  "Successfully logged out and removed compute-device identity.":
    "已成功退出登录并移除计算设备身份。",
  "Successfully logged out.": "已成功退出登录。",
  "Bootstrap the CLI": "初始化 CLI",
  "Skip confirmation prompts": "跳过确认提示",
  "No loaded model found, load with:\n       lms load":
    "未找到已加载的模型，请使用以下命令加载：\n       lms load",
  "Did not find the model. Please select a model to use:": "未找到该模型，请选择要使用的模型：",
  "No model selected, exiting.": "未选择模型，正在退出。",
  "No runtime extensions matched the query.": "没有匹配查询的运行时扩展。",
  "Multiple runtime extensions matched the query. Selecting the first result because --yes was provided.":
    "有多个运行时扩展匹配查询。由于提供了 --yes，将选择第一个结果。",
  "Multiple runtime extensions matched the query. Re-run with a more specific query or use -l to list all matches.":
    "有多个运行时扩展匹配查询。请使用更精确的查询重新运行，或用 -l 列出全部匹配项。",
  "Select the runtime using:": "使用以下命令选择运行时：",
  "Download or list runtime extensions.": "下载或列出运行时扩展。",
  "Query runtime extensions. Examples: 'llama.cpp', 'llama.cpp:cuda', 'llama.cpp@1.2.3'":
    "查询运行时扩展。示例：'llama.cpp'、'llama.cpp:cuda'、'llama.cpp@1.2.3'",
  "List runtime extensions without downloading": "仅列出运行时扩展，不进行下载",
  "Include runtime extensions that are incompatible with your system":
    "包含与你的系统不兼容的运行时扩展",
  "Override the runtime extension channel to query from (examples: stable, beta)":
    "覆盖查询所用的运行时扩展渠道（例如：stable、beta）",
  "Automatically pick the first result when multiple matches are found":
    "匹配到多个结果时自动选择第一个",
  "Use 'lms runtime ls' to see installed runtime extensions.":
    "使用 'lms runtime ls' 查看已安装的运行时扩展。",
  "Multiple runtime extensions found:": "找到多个运行时扩展：",
  "Please disambiguate by specifying a version.": "请通过指定版本来消除歧义。",
  "Select installed LLM engines": "选择已安装的 LLM 引擎",
  "Alias of an LLM engine": "LLM 引擎的别名",
  "Select the latest version": "选择最新版本",
  "Removal cancelled.": "已取消移除。",
  "Remove installed runtime extension packs": "移除已安装的运行时扩展包",
  "Name of a runtime extension pack": "运行时扩展包的名称",
  "Answer yes to all confirmations": "对所有确认均回答“是”",
  "Do not execute the operation": "不实际执行该操作",
  "Manage and update the inference runtime": "管理和更新推理运行时",
  "No runtimes found.": "未找到运行时。",
  "List installed LLM engines": "列出已安装的 LLM 引擎",
  "No GPUs detected": "未检测到 GPU",
  "Survey hardware available to selected runtime engines": "检测所选运行时引擎可用的硬件",
  "Output the raw JSON response": "输出原始 JSON 响应",
  "Resurvey selected and new runtimes": "重新检测所选及新增运行时",
  "No runtime survey results": "无运行时检测结果",
  "Update Plan:": "更新计划：",
  "Update cancelled.": "已取消更新。",
  "Checking updates for all installed runtime extensions...":
    "正在检查所有已安装运行时扩展的更新...",
  "All matching runtime extensions are already up-to-date.": "所有匹配的运行时扩展均已是最新。",
  "Update installed runtime extensions.": "更新已安装的运行时扩展。",
  "Update all installed runtime extensions": "更新所有已安装的运行时扩展",
  "Show extensions that would be updated without performing downloads":
    "仅显示将被更新的扩展，不执行下载",
  "Set the preferred LM Link device for model resolution": "设置模型解析时首选的 LM Link 设备",
  "Device identifier to set as preferred": "要设为首选的设备标识符",
  "No devices are available to set as preferred.": "没有可设为首选的设备。",
  "Available device identifiers:": "可用的设备标识符：",
  "Cannot prompt for a preferred device in a non-interactive environment. Re-run with a device identifier argument.":
    "无法在非交互式环境中提示选择首选设备。请携带设备标识符参数重新运行。",
  "Display the status of LM Link": "显示 LM Link 状态",
  "    Loaded Models Instances:": "    已加载的模型实例：",
  "Enable LM Link on this device": "在本设备上启用 LM Link",
  "LM Link is enabled and online.": "LM Link 已启用并在线。",
  "LM Link enabled. Connecting...": "LM Link 已启用，正在连接...",
  "LM Link is now online.": "LM Link 现已在线。",
  "Something went wrong enabling LM Link. Please try again": "启用 LM Link 时出现问题，请重试",
  "Disable LM Link on this device": "在本设备上禁用 LM Link",
  "Set the local LM Link device name": "设置本地 LM Link 设备名称",
  "New device name": "新的设备名称",
  "Commands for managing LM Link": "管理 LM Link 的命令",
  "Check the status of the LM Studio daemon": "检查 LM Studio 守护进程状态",
  "Output status in JSON format": "以 JSON 格式输出状态",
  "LM Studio is not running": "LM Studio 未在运行",
  "Manually start the llmster daemon": "手动启动 llmster 守护进程",
  "Output result in JSON format": "以 JSON 格式输出结果",
  "Manually shutdown the llmster daemon": "手动关闭 llmster 守护进程",
  "Daemon is not running.": "守护进程未在运行。",
  "Shutting down llmster...": "正在关闭 llmster...",
  "Done.": "完成。",
  "The daemon is currently running as part of LM Studio. Please exit LM Studio to stop it.":
    "守护进程当前作为 LM Studio 的一部分运行。请退出 LM Studio 以停止它。",
  "Commands for managing the LM Studio daemon": "管理 LM Studio 守护进程的命令",
  "Update the llmster daemon": "更新 llmster 守护进程",
  "Use the beta channel for the daemon upgrade": "守护进程升级使用 beta 渠道",
  "Use the specified channel for the daemon upgrade": "守护进程升级使用指定渠道",
  '"lms dev" currently does not support changing the runner type dynamically. Please re-run "lms dev".':
    '"lms dev" 目前不支持动态更改运行器类型，请重新运行 "lms dev"。',
  "Starts a plugin dev server in the current folder": "在当前文件夹启动插件开发服务器",
  "When specified, instead of starting the development server, installs the plugin to LM Studio.":
    "指定后，将不启动开发服务器，而是把插件安装到 LM Studio。",
  "Automatically approve all prompts. Useful for scripting. When used with --install, it will overwrite the plugin without asking.":
    "自动确认所有提示，便于脚本使用。与 --install 搭配时，将不经询问直接覆盖该插件。",
  'When specified, will not produce the "Plugin started" notification in LM Studio.':
    "指定后，不会在 LM Studio 中产生“插件已启动”通知。",
  "Failed to parse the manifest file.": "解析 manifest 文件失败。",
  "No package.json found in the plugin folder.": "插件文件夹中未找到 package.json。",
  "Installing npm dependencies...": "正在安装 npm 依赖...",
  "The version of lms you are using only supports plugins.": "你所使用的 lms 版本仅支持插件。",
  "The version of lms you are using only supports node/deno plugins.":
    "你所使用的 lms 版本仅支持 node/deno 插件。",
  "Disconnected from the server. Stopping the development server.":
    "已与服务器断开连接，正在停止开发服务器。",
  "Error while disposing the client.": "释放客户端时出错。",
  "Setting the preference to always fetch the model catalog.": "正在将偏好设置为始终获取模型目录。",
  "Start an interactive chat with a model": "与模型开始交互式对话",
  "Model name to use": "要使用的模型名称",
  "Print response to stdout and quit": "将响应输出到标准输出后退出",
  "Custom system prompt to use for the chat": "本次对话使用的自定义系统提示词",
  "Display detailed prediction statistics after each response": "每次响应后显示详细的预测统计",
  "Time (in seconds) to keep the model loaded after the chat ends":
    "对话结束后模型保持加载的时间（秒）",
  "Reasoning mode for this chat session": "本次对话的推理模式",
  "Skip fetching the model catalog": "跳过获取模型目录",
  "Assume 'yes' as answer to all CLI prompts": "对所有 CLI 提示默认回答“是”",
  "Invalid TTL value, must be a non-negative integer.": "TTL 值无效，必须是非负整数。",
  "No model loaded. Please specify a model to chat with.": "未加载模型。请指定要对话的模型。",
  "No prompt provided for non-interactive chat.": "非交互式对话未提供提示内容。",
  "Server: {status} (port: {port})": "服务器：{status}（端口：{port}）",

  "ON": "开启",

  "No Models Loaded": "未加载任何模型",

  "Loaded Models": "已加载的模型",

  "Server: {status}\n\n{hint}\n\n    lms server start":
    "服务器：{status}\n\n{hint}\n\n    lms server start",

  "(i) To start the server, run the following command:": "(i) 要启动服务器，请运行以下命令：",

  "Unloading {target}...": "正在卸载 {target}...",

  "Unloaded {count} models.": "已卸载 {count} 个模型。",

  "Unloaded 1 model.": "已卸载 1 个模型。",

  "Model {target} unloaded.": "模型 {target} 已卸载。",

  "Multiple models found. Select one to unload": "找到多个模型，请选择要卸载的一个",

  "! To unload all models, use the --all flag.": "! 要卸载所有模型，请使用 --all 标志。",

  "Select a model to unload": "请选择要卸载的模型",
  'The port where LM Studio can be reached. If not provided and the host is set to "127.0.0.1" (default), the last used port will be used; otherwise, {defaultPort} will be used.':
    'LM Studio 监听的端口。若未提供且主机为 "127.0.0.1"（默认），将使用上次使用的端口；否则将使用 {defaultPort}。',
  'You don\'t have any models loaded. Use "lms load" to load a model.':
    '你没有任何已加载的模型。请使用 "lms load" 加载一个模型。',
  "This operation requires you to be authenticated. Inline authentication disabled due to {p0} flag. Please use {p1} to authenticate before running this command again.":
    "此操作需要先完成身份验证。由于 {p0} 标志，已禁用内联身份验证。请先使用 {p1} 完成身份验证，然后重新运行此命令。",
  "Visit {p0} and enter the following code to authenticate:":
    "请访问 {p0} 并输入以下验证码完成身份验证：",
  "{p0} / {p1} | {p2}/s | ETA {p3}": "{p0} / {p1} | {p2}/s | 预计剩余 {p3}",
  "Cannot Log In\n\nThis instance is currently logged in as a compute device for {p0}.\n\nTo log in as a user, you must log out first using the command {p1}.":
    "无法登录\n\n此实例当前已作为计算设备登录到 {p0}。\n\n要以用户身份登录，必须先使用命令 {p1} 退出登录。",
  "Cannot Log In As Compute Device\n\nThis instance is currently logged in as {p0}.\n\nTo log in as a compute device, you must log out first using the command {p1}.":
    "无法以计算设备身份登录\n\n此实例当前已登录为 {p0}。\n\n要以计算设备身份登录，必须先使用命令 {p1} 退出登录。",
  "Already Logged In As Compute Device\n\nThis instance is currently logged in as a compute device for {p0}.\n\nTo log in again, you must first use the command {p1}.":
    "已作为计算设备登录\n\n此实例当前已作为计算设备登录到 {p0}。\n\n要重新登录，必须先使用命令 {p1}。",
  "Host should not include the port number. Use {p0} instead.":
    "主机地址不应包含端口号。请改用 {p0}。",
  "The server does not appear to be running at {p0}:{p1}. Please make sure the server is running and accessible at the specified address.":
    "在 {p0}:{p1} 上似乎没有运行服务器。请确认服务器已启动，且指定地址可以访问。",
  "Only one of {p0}, {p1}, or {p2} can be specified.":
    "{p0}、{p1} 和 {p2} 三个标志只能指定其中一个。",
  "Please edit the manifest.json and set the owner field to your LM Studio Hub username.":
    "请编辑 manifest.json，将 owner 字段设置为你的 LM Studio Hub 用户名。",
  "(i) You can create a {p0} or {p1} file to filter out unwanted files.":
    "(i) 你可以创建 {p0} 或 {p1} 文件来过滤掉不需要的文件。",
  "Path already exists: {p0}\n       You can provide a different path by providing it as a second argument.":
    "路径已存在：{p0}\n       可通过第二个参数指定其他路径。",
  "Path already exists: {p0}": "路径已存在：{p0}",
  "Artifact successfully cloned to {p0}.": "制品已成功克隆到 {p0}。",
  "Searching staff picks with the term": "正在按关键词搜索编辑精选",
  "Model already downloaded. To use, run: {p0}": "模型已下载。要使用，请运行：{p0}",
  "If you wish to download a variant, run: {p0}": "如果要下载某个变体，请运行：{p0}",
  "Cannot find variant {p0}.": "找不到变体 {p0}。",
  "The parameter {p0} is required when using the {p1} flag.": "使用 {p1} 标志时必须提供参数 {p0}。",
  'No model found with path being exactly "{p0}".\n\nTo disable exact matching, remove the {p1} flag.\n\nTo see a list of all downloaded models, run:\n\n    {p2}':
    '未找到路径完全匹配 "{p0}" 的模型。\n\n要关闭精确匹配，请移除 {p1} 标志。\n\n要查看所有已下载的模型，请运行：\n\n    {p2}',
  'No model found with path being exactly "{p0}".\n\nTo disable exact matching, remove the {p1} flag.\n\nTo see a list of all downloaded models, run:\n\n    {p2}\n\nNote, you need to provide the full model path. For example:\n\n  lms load --exact {p3}':
    '未找到路径完全匹配 "{p0}" 的模型。\n\n要关闭精确匹配，请移除 {p1} 标志。\n\n要查看所有已下载的模型，请运行：\n\n    {p2}\n\n注意，需要提供完整的模型路径。例如：\n\n  lms load --exact {p3}',
  'No model found that matches model key "{p0}".\n\nTo see a list of all downloaded models, run:\n\n    {p1}\n\nTo select a model interactively, remove the {p2} flag:\n\n    lms load':
    '未找到与模型 key "{p0}" 匹配的模型。\n\n要查看所有已下载的模型，请运行：\n\n    {p1}\n\n要以交互方式选择模型，请移除 {p2} 标志：\n\n    lms load',
  "! Cannot find a model matching the provided model key ({p0}). Please select one from the list below.":
    "! 找不到与所提供的模型 key（{p0}）匹配的模型。请从下面的列表中选择一个。",
  "Model loaded successfully in {time}.": "模型加载成功，用时 {time}。",
  "Model loaded successfully on {device} in {time}.": "模型已在 {device} 上加载成功，用时 {time}。",
  "{p0}{p1}": "{p0}{p1}",
  'To use the model in the API/SDK, use the identifier "{p0}".':
    '要在 API/SDK 中使用该模型，请使用标识符 "{p0}"。',
  "Context Length: {p0}": "上下文长度：{p0}",
  "GPU Offload: {p0}%": "GPU 卸载比例：{p0}%",
  "Estimated GPU Memory:   {p0}": "预估 GPU 显存：   {p0}",
  "Estimated Total Memory: {p0}": "预估总内存：{p0}",
  "Confidence: {p0}": "置信度：{p0}",
  "Successfully logged in as a compute device for {p0} {p1}.":
    "已成功作为计算设备登录到 {p0} {p1}。",
  "Successfully logged in as {p0}.": "已成功登录为 {p0}。",
  "You are already authenticated as {p0}.": "你已登录，当前身份为 {p0}。",
  "Provide the path to the model file you downloaded (e.g. .gguf).\n\nExample:\n\n    {p0}":
    "请提供你已下载的模型文件路径（例如 .gguf）。\n\n示例：\n\n    {p0}",
  "Target file already exists:": "目标文件已存在：",
  "Would move the file to": "将把文件移动到",
  "Would copy the file to": "将把文件复制到",
  "Would create a hard link at": "将在以下位置创建硬链接",
  "Would create a symbolic link at": "将在以下位置创建符号链接",
  "But not actually doing it because of {p0}": "但由于 {p0}，实际并未执行",
  "File moved to": "文件已移动到",
  "File copied to": "文件已复制到",
  "Hard link created at": "硬链接已创建于",
  "Symbolic link created at": "符号链接已创建于",
  "Model files usually have extensions: {p0}": "模型文件的扩展名通常为：{p0}",
  "{p0}{p1}\n\nThis file does not look like a model file:\n\n    {p2}\n\nModel files usually have extension: {p3}{p4}":
    "{p0}{p1}\n\n此文件看起来不像模型文件：\n\n    {p2}\n\n模型文件的扩展名通常为：{p3}{p4}",
  "File does not look like a model file": "文件看起来不像模型文件",
  "Could not locate LM Studio configuration file, using default path:":
    "未找到 LM Studio 配置文件，将使用默认路径：",
  "Could not parse LM Studio configuration file, using default path:":
    "解析 LM Studio 配置文件失败，将使用默认路径：",
  "{p0}{p1}\n\nBy default, {p2} will {p3} the file to LM Studio's models folder:\n\n    {p4}\n\nIf you want to {p5} the file instead, use the {p6} flag.\n\nIf you want to create a {p7} instead, use the {p8} flag.\n\nIf you want to create a {p9} instead, use the {p10} flag.\n\nThis message will only show up once. You can always look up the usage via the {p11} flag.{p12}":
    "{p0}{p1}\n\n默认情况下，{p2} 会把文件{p3}到 LM Studio 的模型目录：\n\n    {p4}\n\n若要改为{p5}文件，请使用 {p6} 标志。\n\n若要改为创建{p7}，请使用 {p8} 标志。\n\n若要改为创建{p9}，请使用 {p10} 标志。\n\n此提示仅显示一次。随时可通过 {p11} 标志查看用法。{p12}",
  "Importing model file into LM Studio": "正在将模型文件导入 LM Studio",
  "move": "移动",
  "copy": "复制",
  "symbolic link": "符号链接",
  "hard link": "硬链接",
  "Auto search Hugging Face {p0}": "自动搜索 Hugging Face {p0}",
  "Interactive import {p0}": "交互式导入 {p0}",
  "Don't categorize {p0}": "不进行分类 {p0}",
  "You cannot provide {p0} when the flag {p1} is set.": "设置了 {p1} 标志时不能提供 {p0}。",
  'Cannot find a model with the identifier "{p0}".\n\nTo see a list of loaded models, run:\n\n    {p1}':
    '找不到标识符为 "{p0}" 的模型。\n\n要查看已加载的模型，请运行：\n\n    {p1}',
  'Flag "{p0}" is currently enabled.': '标志 "{p0}" 当前已启用。',
  'Flag "{p0}" is currently disabled.': '标志 "{p0}" 当前已禁用。',
  'Set flag "{p0}" to {p1}.': '已将标志 "{p0}" 设置为 {p1}。',
  "Failed to fetch scaffolds": "获取脚手架列表失败",
  "Cannot parse some of the scaffolds. This is likely due to outdated LM Studio Version.":
    "部分脚手架无法解析。这可能是因为 LM Studio 版本过旧。",
  " {p0}\n\nSelect a scaffold to use from the list below.":
    " {p0}\n\n请从下面的列表中选择要使用的脚手架。",
  "Welcome to LM Studio Interactive Project Creator": "欢迎使用 LM Studio 交互式项目创建器",
  "Failed to parse scaffold data. This is likely due to outdated LM Studio Version.":
    "解析脚手架数据失败。这可能是因为 LM Studio 版本过旧。",
  'The project name "{p0}" is not allowed.': '项目名称 "{p0}" 不被允许。',
  'The project name "{p0}" contains illegal character "{p1}".':
    '项目名称 "{p0}" 包含非法字符 "{p1}"。',
  'The directory/file "{p0}" already exists.': '目录/文件 "{p0}" 已存在。',
  "is LM Studio's CLI utility for your models, server, and inference runtime.":
    "是 LM Studio 提供的模型、服务器与推理运行时命令行工具。",
  "Listing variants for {p0}:": "正在列出 {p0} 的变体：",
  "You have {p0} models, taking up {p1} of disk space.": "你共有 {p0} 个模型，占用 {p1} 磁盘空间。",
  "Success! Server is now running on port {p0}": "成功！服务器现已运行在端口 {p0} 上",
  "The server is not running.": "服务器未运行。",
  "Stopped the server on port {p0}.": "已停止端口 {p0} 上的服务器。",
  "The server is running on port {p0}.": "服务器正在端口 {p0} 上运行。",
  'Model "{p0}" not found, load with:\n       lms load {p1}':
    '未找到模型 "{p0}"，请运行以下命令加载：\n       lms load {p1}',
  "Download {p0}@{p1}...": "正在下载 {p0}@{p1}...",
  "  lms runtime select {p0}@{p1}": "  lms runtime select {p0}@{p1}",
  "No installed runtime extensions found matching: ": "未找到匹配的已安装运行时扩展：",
  "Cannot prompt for confirmation in a non-interactive environment. Re-run with --yes.":
    "非交互式环境中无法请求确认。请加上 --yes 重新运行。",
  "Checking updates for selected installed runtime extensions... (Pass --all to include all)":
    "正在检查所选已安装运行时扩展的更新...（加上 --all 可包含全部）",
  "{p0}@{p1} is already installed.": "{p0}@{p1} 已安装。",
  'Unknown device identifier "{p0}".': '未知的设备标识符 "{p0}"。',
  'Updated preferred device to "{p0}" ({p1}).': '已将首选设备更新为 "{p0}"（{p1}）。',
  "This device: {p0}": "本设备：{p0}",
  "Status: {p0}": "状态：{p0}",
  "Last error: {p0} ({p1}s ago)": "最近一次错误：{p0}（{p1} 秒前）",
  "Found {p0} device{p1}:": "发现 {p0} 台设备：",
  "    Status: {p0}": "    状态：{p0}",
  "    Identifier: {p0}": "    标识符：{p0}",
  "      ... (and {p0} more)": "      ...（另有 {p0} 台）",
  "Failed to connect: {p0}": "连接失败：{p0}",
  'Updated device name to "{p0}".': '已将设备名称更新为 "{p0}"。',
  "{p0} v{p1} is running (PID: {p2})": "{p0} v{p1} 正在运行（PID：{p2}）",
  "Cannot find install location file at {p0}.": "找不到 {p0} 处的安装位置文件。",
  "Failed to read or parse install location from {p0} at {p1}:":
    "从 {p0} 读取或解析安装位置失败（{p1}）：",
  "Install location file {p0} at {p1} does not contain a valid executable path.":
    "{p1} 处的安装位置文件 {p0} 不包含有效的可执行文件路径。",
  "The daemon is already running (PID: {p0}).": "守护进程已在运行（PID：{p0}）。",
  "LM Studio is already running (PID: {p0}); not starting a second daemon.":
    "LM Studio 已在运行（PID：{p0}），不会再启动第二个守护进程。",
  "llmster started (PID: {p0}).": "llmster 已启动（PID：{p0}）。",
  "LM Studio started (PID: {p0}).": "LM Studio 已启动（PID：{p0}）。",
  'Could not update: "ldconfig" must be available on your PATH before updating.\n\nPlease ensure ldconfig is installed and in your PATH, then run this again:\n\n      lms daemon update\n\nError details: {p0}\n':
    "更新失败：更新前必须确保 ldconfig 已在你的 PATH 中。\n\n请确认 ldconfig 已安装并加入 PATH，然后重新运行：\n\n      lms daemon update\n\n错误详情：{p0}\n",
  '📣 Notice: One-time dependency update needed.\n\nThe next version of llmster requires "libatomic", which is not currently installed on your system.\n\n1. To install it:\n\n      Debian/Ubuntu: sudo apt-get update && sudo apt-get install -y libatomic1\n      Fedora/RHEL:  sudo dnf install -y libatomic\n\n2. Afterwards, run this again:\n\n      lms daemon update\n':
    '📣 提示：需要一次性更新依赖\n\nllmster 的下一个版本需要 "libatomic"，但你的系统尚未安装。\n\n1. 安装方法：\n\n      Debian/Ubuntu: sudo apt-get update && sudo apt-get install -y libatomic1\n      Fedora/RHEL:  sudo dnf install -y libatomic\n\n2. 安装完成后再次运行：\n\n      lms daemon update\n',
  "Starting llmster upgrade using {p0}...": "正在使用 {p0} 升级 llmster...",
  "Failed to launch llmster for upgrade:": "启动 llmster 以执行升级失败：",
  "Installing the plugin {p0}/{p1}...": "正在安装插件 {p0}/{p1}...",
  "Successfully installed {p0}/{p1}.": "已成功安装 {p0}/{p1}。",
  "Starting the development server for {p0}/{p1}...": "正在为 {p0}/{p1} 启动开发服务器...",
  "Error during chat:": "对话过程中出错：",
  "Authentication required": "需要身份验证",
  "Failed to start or connect to local LM Studio API server.":
    "启动或连接本地 LM Studio API 服务器失败。",
  "Failed to connect using {path}.": "连接 {path} 失败。",
  "CLI commit: ": "CLI 提交：",
  "(Used ignore file {file}).": "（使用了忽略文件 {file}。）",
  "! Use the arrow keys to navigate, and press enter to select.": "! 使用方向键移动，按回车选择。",
  "Model already downloaded.": "模型已下载。",
  "Everything is already downloaded": "所有内容均已下载",
  "Cannot find variant {variant}, please select one from below.":
    "找不到变体 {variant}，请从下方选择一个。",
  "Unsupported load option": "不支持的加载选项",
  "Engine configuration options can only be configured for LLM models.":
    "引擎配置选项只能针对 LLM 模型配置。",
  "Path not provided": "未提供路径",
  "Model not found": "未找到模型",
  "Invalid Usage": "用法错误",
  "Cannot specify more than one of --copy, --hard-link, or --symbolic-link":
    "不能同时指定 --copy、--hard-link 和 --symbolic-link 中的多个",
  "Model Not Found": "未找到模型",
  "CLI commit:": "CLI 提交：",
  "Cannot combine a model key argument with --variants.":
    "不能将模型 key 参数与 --variants 同时使用。",
  "The '--detailed' flag is deprecated. Output is the same as 'lms ls'":
    "'--detailed' 标志已弃用。输出与 'lms ls' 相同",
  "You have not downloaded any models yet.": "你还没有下载任何模型。",
  "You have {count} models, but none of them match the filter.":
    "你共有 {count} 个模型，但没有一个符合筛选条件。",
  "Survey by {name} ({version}).": "检测结果来自 {name}（{version}）。",
  "Updated {name} to version {version}.": "已将 {name} 更新到 {version} 版本。",
  "LM Link enabled, but you are not authenticated. Run {command} to continue.":
    "LM Link 已启用，但你尚未登录。运行 {command} 继续。",
  "LM Link enabled, but you do not have access. Visit {url}":
    "LM Link 已启用，但你没有访问权限。请访问 {url}",
  "LM Link is enabled. However, LM Link cannot connect because the protocol has updated. You need to update {target} to continue using LM Link.":
    "LM Link 已启用，但由于协议已更新而无法连接。你需要更新 {target} 才能继续使用 LM Link。",
  "Run {command} to update.": "运行 {command} 进行更新。",
  "LM Link will continue to retry connection in the background. Use {command} to check current status.":
    "LM Link 将在后台继续尝试连接。使用 {command} 查看当前状态。",
  "LM Link enabled but could not connect. Use {command} for details.":
    "LM Link 已启用但无法连接。使用 {command} 查看详情。",
  "{p0} models match the provided model key on the same device. Loading the first one.":
    "同一设备上有 {p0} 个模型匹配所提供的模型 key，正在加载第一个。",
  "Cannot find the model on Hugging Face, you need to manually specify the user/repo.":
    "在 Hugging Face 上找不到该模型，你需要手动指定 user/repo。",
  "No models are currently loaded.\n\nTo load a model, run:\n\n    {p0}":
    "当前未加载任何模型。\n\n要加载模型，请运行：\n\n    {p0}",
  "Invalid model name '{p0}'. Please provide a model name in the format 'owner/model-name'.":
    "模型名称 '{p0}' 无效。请使用 'owner/model-name' 格式的模型名称。",
  "Unable to download or load the requested model '{p0}'. Please check the model name and try downloading it first with 'lms get'.":
    "无法下载或加载所请求的模型 '{p0}'。请检查模型名称，并先用 'lms get' 尝试下载。",
  "Model {p0} is not downloaded. Please download the model first with 'lms get'.":
    "模型 {p0} 尚未下载。请先用 'lms get' 下载该模型。",
  "However, {p0} incompatible runtime extension(s) were found. Re-run with --allow-incompatible to see and download them.":
    "不过，发现了 {p0} 个不兼容的运行时扩展。请加上 --allow-incompatible 重新运行以查看并下载它们。",
  "Selected {p0}@{p1} for {p2}": "已为 {p2} 选择 {p0}@{p1}",
  "Already selected {p0}@{p1} for {p2}": "{p2} 已选择 {p0}@{p1}",
  "Updating {p0} from {p1} to {p2}...": "正在将 {p0} 从 {p1} 更新到 {p2}...",
  "LM Link not running because you are not logged in. Use {p0} to login.":
    "LM Link 未运行，因为你尚未登录。使用 {p0} 登录。",
  "You do not have access to LM Link. Visit {p0} to request access.":
    "你没有 LM Link 的访问权限。访问 {p0} 申请权限。",
  "Note: LM Link is disabled. Run {p0} to enable it.": "注意：LM Link 已禁用。运行 {p0} 启用它。",
  "You have disabled LM Link. To re-enable it, run {p0}.":
    "你已禁用 LM Link。要重新启用，请运行 {p0}。",
  "LM Link cannot connect because the protocol has updated. You need to update {p0} to continue using LM Link.":
    "LM Link 无法连接，因为协议已更新。你需要更新 {p0} 才能继续使用 LM Link。",
  "Run {p0} to update.": "运行 {p0} 进行更新。",
  "LM Link was already disabled on this device. No changes were made. Use {p0} to re-enable.":
    "本设备上的 LM Link 已处于禁用状态，未做任何更改。使用 {p0} 重新启用。",
  "You have disabled LM Link on this device. Use {p0} to re-enable.":
    "你已在本设备上禁用 LM Link。使用 {p0} 重新启用。",
  "The value to set the flag to": "要将标志设置为的值",
  "Docs:": "文档：",
  "Contribute:": "参与贡献：",
  "Invalid selection. Please enter {p0}.\n": "选择无效。请输入 {p0}。\n",
  "Error reading data from file: {p0}": "读取文件数据出错：{p0}",
  "Error writing data to file: {p0}": "写入文件数据出错：{p0}",
  'Invalid version format: "{p0}". Expected MAJOR.MINOR.PATCH with numbers only.':
    '版本格式无效："{p0}"。应为仅含数字的 MAJOR.MINOR.PATCH 格式。',
  "Invalid component {p0} in {p1}": "{p1} 中的版本号组成部分 {p0} 无效",
  "You are not currently logged in.": "您当前未登录。",
  "You are currently logged in as: {p0}": "您当前登录的身份为：{p0}",
  "You are currently logged in as a compute device for ": "您当前已作为计算设备登录到 ",
  "Unexpected authentication status: {p0}": "意外的身份验证状态：{p0}",
  "Connection timed out.": "连接超时。",
  "Download completed.": "下载完成。",
  "Continue to download in the background?": "是否在后台继续下载？",
  "Not a number": "不是数字",
  "Not a finite number": "不是有限数字",
  "Not an integer": "不是整数",
  "Number out of range, must be at least {p0}": "数值超出范围，必须不小于 {p0}",
  "Number out of range, must be at most {p0}": "数值超出范围，必须不大于 {p0}",
  "Invalid JSON string": "JSON 字符串无效",
  "SKILL.md must contain YAML frontmatter with a name and description.":
    "SKILL.md 必须包含带有 name 和 description 的 YAML frontmatter。",
  "Skill name is required in SKILL.md.": "SKILL.md 中必须提供 Skill 名称。",
  "Skill description is required in SKILL.md.": "SKILL.md 中必须提供 Skill 描述。",
  "Skill name must be a kebab-case string between 1 and 63 characters.":
    "Skill 名称必须是 1 到 63 个字符的 kebab-case 字符串。",
  "Skill folder name must match the name in SKILL.md. Received {p0}, expected {p1}.":
    "Skill 文件夹名必须与 SKILL.md 中的名称一致。实际为 {p0}，应为 {p1}。",
  "Your account does not have an artifact owner available for publishing.":
    "您的账号没有可用于发布的制品所有者。",
  "Multiple artifact owners are available. Run lms push in an interactive terminal to select one or create a manifest.json that specifies the owner.":
    "存在多个可用的制品所有者。请在交互式终端中运行 lms push 选择其一，或创建指定 owner 的 manifest.json。",
  "Select an owner": "选择所有者",
  "Invalid {p0}: {p1}": "{p0} 无效：{p1}",
  "Invalid artifact identifier. Must be in the form of 'owner/name'.":
    '制品标识符无效，必须为 "owner/name" 形式。',
  "Invalid owner. Must be kebab-case.": "所有者无效，必须为 kebab-case 格式。",
  "Invalid name. Must be kebab-case (dots allowed).":
    "名称无效，必须为 kebab-case 格式（允许点号）。",
  "You cannot have more than 2 @'s in the model name argument.":
    '模型名称参数中不能包含超过 2 个 "@"。',
  "Only https://huggingface.co URLs are supported.": "仅支持 https://huggingface.co 的 URL。",
  "Invalid Hugging Face model URL. Expected https://huggingface.co/owner/repo[/*].":
    "Hugging Face 模型 URL 无效。应为 https://huggingface.co/owner/repo[/*] 形式。",
  "No staff picks found with the specified search criteria.": "未找到符合指定搜索条件的编辑精选。",
  "The --select flag cannot be used with --yes.": "--select 标志不能与 --yes 同时使用。",
  "The --select flag requires an interactive terminal.": "--select 标志需要交互式终端。",
  "Select a model to download": "选择要下载的模型",
  "[Exact Match] ": "[完全匹配] ",
  " Won't Fit ": " 放不下 ",
  " CPU Fit ": " 仅CPU ",
  " Partial GPU ": " 部分GPU ",
  " Full GPU ": " 全GPU ",
  " ★ Recommended ": " ★ 推荐 ",
  " ✓ Downloaded ": " ✓ 已下载 ",
  " ⌛ Downloading ": " ⌛ 下载中 ",
  "Select a variant": "选择变体",
  "↓ To download:": "↓ 要下载：",
  "⧗ {p0} - Pending...": "⧗ {p0} - 等待中...",
  "[Editing]": "[编辑中]",
  "⧗ Concrete Model - Pending...": "⧗ 具体模型 - 等待中...",
  "This download is already in progress.": "该下载已在进行中。",
  "Resolution completed. Downloading {p0}...": "解析完成，正在下载 {p0}...",
  "About to download {p0}.": "即将下载 {p0}。",
  " Resolving download plan... ({p0})": " 正在解析下载方案...（{p0}）",
  " Resolving download plan...": " 正在解析下载方案...",
  "Follow the download?": "跟随该下载？",
  "Start download?": "开始下载？",
  "Change variant selection": "更改变体选择",
  "change variant selection": "更改变体选择",
  "Number out of range, must be between 0 and 1": "数值超出范围，必须在 0 到 1 之间",
  "Engine configuration file is empty. Use --no-engine-config-file to disable config-file mode.":
    "引擎配置文件为空。使用 --no-engine-config-file 关闭配置文件模式。",
  "Select a model to {p0}": "选择要{p0}的模型",
  "This model may be loaded based on your resource guardrails settings.":
    "根据您的资源护栏设置，该模型可能加载成功。",
  "This model will fail to load based on your resource guardrails settings.":
    "根据您的资源护栏设置，该模型将无法加载。",
  "Invalid LM Studio artifact URL. Expected https://lmstudio.ai/models/owner/name or https://lmstudio.ai/owner/name.":
    "LM Studio 制品 URL 无效。应为 https://lmstudio.ai/models/owner/name 或 https://lmstudio.ai/owner/name。",
  "Only https://lmstudio.ai URLs are supported.": "仅支持 https://lmstudio.ai 的 URL。",
  "Must be user and repo separated by a slash.": "必须是用斜杠分隔的用户和仓库名。",
  "File does not exist": "文件不存在",
  "Path is not a file": "路径不是文件",
  "Do you wish to continue? (Not recommended)": "是否继续？（不推荐）",
  "Unsupported platform": "不支持的平台",
  "Do you wish to continue?": "是否继续？",
  "{p0} cannot be empty": "{p0} 不能为空",
  "{p0} is too long": "{p0} 过长",
  '{p0} cannot start or end with "."': '{p0} 不能以 "." 开头或结尾',
  "{p0} cannot have leading or trailing spaces": "{p0} 不能包含首尾空格",
  "Search results returned an invalid model index.": "搜索结果返回了无效的模型索引。",
  "Expected 'true' or 'false'": "应为 'true' 或 'false'",
  "Invalid response from the server.": "服务器返回了无效响应。",
  "Select a scaffold to use": "选择要使用的脚手架",
  "npm install exited with code {p0}": "npm install 退出，代码 {p0}",
  "✓ LOADED": "✓ 已加载",
  "✓ LOADED ({p0})": "✓ 已加载（{p0}）",
  "Logging out...": "正在退出登录...",
  "Select a model to chat with": "选择要对话的模型",
  "Offline, unable to fetch model catalog": "离线，无法获取模型目录",
  "Error fetching model catalog:": "获取模型目录出错：",
  "Loading {p0} {p1}%": "正在加载 {p0} {p1}%",
  "\n\nPrediction Stats:": "\n\n预测统计：",
  "\n  Stop Reason: {p0}": "\n  停止原因：{p0}",
  "\n  Tokens/Second: {p0}": "\n  每秒 token 数：{p0}",
  "\n  Time to First Token: {p0}s": "\n  首个 token 用时：{p0}s",
  "\n  Prompt Tokens: {p0}": "\n  提示 token 数：{p0}",
  "\n  Predicted Tokens: {p0}": "\n  预测 token 数：{p0}",
  "\n  Total Tokens: {p0}": "\n  token 总数：{p0}",
  "\nGeneration interrupted by user with Ctrl^C\n": "\n用户按 Ctrl^C 中断了生成\n",
  "[Pasted {p0} characters...]": "[已粘贴 {p0} 个字符...]",
  "[Pasted{p0}{p1}{p2}]": "[已粘贴{p0}{p1}{p2}]",
  "Show help information": "显示帮助信息",
  "Exit the chat": "退出对话",
  "Load a model (type /model to see list)": "加载模型（输入 /model 查看列表）",
  "Please specify a model to load. Type /model to see the list.":
    "请指定要加载的模型。输入 /model 查看列表。",
  "Model Selected: {p0}": "已选择模型：{p0}",
  'Model "{p0}" not found. Use /download to download it or /model to list available models.':
    '未找到模型 "{p0}"。使用 /download 下载，或用 /model 列出可用模型。',
  "Failed to load model: {p0}": "加载模型失败：{p0}",
  "Clear the chat history": "清空对话历史",
  "Replace the system prompt": "替换系统提示词",
  "Please provide a system prompt.": "请提供系统提示词。",
  "System prompt updated to: ": "系统提示词已更新为：",
  "Show stats of the previous generation": "显示上一次生成的统计信息",
  "No previous generation stats available.": "没有上一次生成的统计信息。",
  "Set reasoning mode (auto, on, off)": "设置推理模式（auto、on、off）",
  "Reasoning mode: {p0}": "推理模式：{p0}",
  "Usage: /reasoning auto|on|off": "用法：/reasoning auto|on|off",
  "Reasoning mode set to: {p0}": "推理模式已设置为：{p0}",
  "Download a model": "下载模型",
  " (current)": "（当前）",
  " (loaded)": "（已加载）",
  "Available commands:\n{p0}\n": "可用命令：\n{p0}\n",
  "No local version": "无本地版本",
  "Same version installed": "已安装相同版本",
  "Downgrade available: {p0} -> {p1}": "可降级：{p0} -> {p1}",
  "Update available: {p0} -> {p1}": "可更新：{p0} -> {p1}",
  "Multiple runtime extensions matched the query. Select one to download:":
    "有多个运行时扩展匹配该查询。请选择一个下载：",
  "Cannot specify version with --latest.": "不能与 --latest 同时指定版本。",
  "Must specify at least one of [alias] or --latest": "必须至少指定 [alias] 或 --latest 之一",
  "About to remove ": "将要移除 ",
  "Would remove ": "会移除 ",
  'No LLM Engines support the "{p0}" model format(s).': '没有 LLM 引擎支持 "{p0}" 模型格式。',
  "Incompatible app version": "应用版本不兼容",
  "Incompatible backend version": "后端版本不兼容",
  "Invalid CPU architecture": "CPU 架构无效",
  "Invalid CPU instruction set extensions": "CPU 指令集扩展无效",
  "CPU survey unsuccessful": "CPU 检测失败",
  "GPU survey unsuccessful": "GPU 检测失败",
  "GPU required but none found": "需要 GPU 但未找到",
  "GPU targets required but none specified": "需要 GPU 目标但未指定",
  "GPU driver unsupported": "GPU 驱动不受支持",
  "No supported GPUs": "没有受支持的 GPU",
  "Incompatible platform": "平台不兼容",
  "Library outdated": "库版本过旧",
  "Invalid library version format": "库版本格式无效",
  "Missing libraries": "缺少库",
  "Error surveying hardware": "检测硬件时出错",
  "Error checking compatibility": "检查兼容性时出错",
  "Compatibility: {p0} - {p1}": "兼容性：{p0} - {p1}",
  "Continue updating runtime extensions?": "是否继续更新运行时扩展？",
  "not installed": "未安装",
  "update available": "有可用更新",
  "newer version installed": "已安装更新的版本",
  "Installing runtime... (this might take a while)": "正在安装运行时...（可能需要一些时间）",
  "Runtime installed.": "运行时已安装。",
  "Select a preferred device": "选择首选设备",
  " (this device)": "（本设备）",
  " (preferred)": "（首选）",
  "Offline (will attempt to reconnect)": "离线（将尝试重新连接）",
  "Shutting down": "正在关闭",
  "Offline (Reconnect in {p0}s)": "离线（{p0} 秒后重连）",
  "exit code {p0}": "退出码 {p0}",
  '"ldconfig -p" failed with {p0}{p1}': '"ldconfig -p" 执行失败，{p0}{p1}',
  "We will run the updater in a new terminal. Hit <ENTER> to continue.":
    "我们将在新终端中运行更新程序。按 <ENTER> 继续。",
  "Failed to read or parse manifest file.": "读取或解析 manifest 文件失败。",
  'Plugin "{p0}" started': '插件 "{p0}" 已启动',
  "This plugin is run by lms CLI development server.": "该插件由 lms CLI 开发服务器运行。",
  "Plugin process exited with code {p0}": "插件进程已退出，代码 {p0}",
  "Plugin process exited with signal {p0}": "插件进程已退出，信号 {p0}",
  "Always fetch the model catalog ? (requires internet connection)":
    "是否始终获取模型目录？（需要联网）",
  "Please specify a model to download using owner/name. Type /model to see the list.":
    "请使用 owner/name 指定要下载的模型。输入 /model 查看列表。",
  "Please use the owner/name format, for example google/gemma-3-1b":
    "请使用 owner/name 格式，例如 google/gemma-3-1b",
  "Failed to resolve download plan: {p0}": "解析下载方案失败：{p0}",
  "Download {p0}/{p1}? This will download approximately {p2}. Type yes to continue or no to cancel.":
    "下载 {p0}/{p1}？这将下载约 {p2}。输入 yes 继续，输入 no 取消。",
  "Download completed: {p0}/{p1}": "下载完成：{p0}/{p1}",
  "Download failed for {p0}/{p1}: {p2}": "{p0}/{p1} 下载失败：{p2}",
  "Download canceled for {p0}/{p1}.": "已取消下载 {p0}/{p1}。",
  "[Response stopped by user]": "[用户已停止响应]",
  "Type ": "输入 ",
  " or Ctrl+C to quit": " 或 Ctrl+C 退出",
  "Chatting with {p0}": "正在与 {p0} 对话",
  "Try one of the following commands:": "试试以下命令：",
  "/model - Load a model (type /model to see list)": "/model - 加载模型（输入 /model 查看列表）",
  "/download - Download a model": "/download - 下载模型",
  "/clear - Clear the chat history": "/clear - 清空对话历史",
  "/help - Show help information": "/help - 显示帮助信息",
  "Layout Overflow - {p0} rendered height exceeds {p1} available height":
    "布局溢出 - {p0} 渲染高度超过可用高度 {p1}",
  "Prediction aborted by user.": "用户中止了生成。",
  "Download interrupted. Continue download in background?": "下载已中断。是否在后台继续下载？",
  "Please answer 'yes' or 'no'": "请输入 'yes' 或 'no'",
  "Unknown command: {p0}": "未知命令：{p0}",
  "No model loaded. Please load a model using /model": "未加载模型。请使用 /model 加载模型",
  "A prediction is already in progress. Please wait for it to finish or press CTRL+C to abort it.":
    "已有生成任务在进行中。请等待其完成，或按 CTRL+C 中止。",
  "Would you like to reload the model?": "是否重新加载模型？",
  "Reloading model...": "正在重新加载模型...",
  "Model reloaded: {p0}": "模型已重新加载：{p0}",
  "Failed to reload model: {p0}": "重新加载模型失败：{p0}",
  "Model reload cancelled.": "已取消重新加载模型。",
  "Prediction error: {p0}": "生成出错：{p0}",
  "Fetching model details for": "正在获取模型详情",
  "Loading model...": "正在加载模型...",
  "Processing prompt...": "正在处理提示...",
  "Type a message or use / to use commands": "输入消息，或使用 / 调用命令",
  "estimate": "预估",
  "load": "加载",
  "OFF": "关闭",
  "unavailable": "不可用",
  "up-to-date": "已是最新",
  "Removed ": "已移除 ",
  "Model: {p0}": "模型：{p0}",
  "\nEstimate: ": "\n预估：",
  "timestamp: ": "时间戳：",
  "type: ": "类型：",
  "modelIdentifier: ": "模型标识符：",
  "modelPath: ": "模型路径：",
  "Yes": "是",
  "yes": "是",
  "No": "否",
  "no": "否",
  "✓ Satisfied": "✓ 已满足",
  "(min. {p0})": "（最少 {p0}）",
  "Choose categorization option": "选择分类方式",
  "Who is the creator of the model?": "该模型的创作者是谁？",
  "What is the model name?": "模型名称是什么？",
  "None of the above": "以上都不是",
  "(Recommended for models downloaded from Hugging Face)": "（推荐用于从 Hugging Face 下载的模型）",
  "(Recommended for custom models)": "（推荐用于自定义模型）",
  "(will put the model under imported-models/uncategorized)":
    "（将模型放入 imported-models/uncategorized）",
  "Run 'lms import -h' for more info.": "运行 'lms import -h' 查看更多信息。",
};
