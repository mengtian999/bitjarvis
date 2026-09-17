const COMMANDS = new Set(["serve", "status", "sessions", "continue", "chat", "bundle", "data", "help"]);
const BUNDLE_SUBCOMMANDS = new Set(["pull", "status"]);
const DATA_SUBCOMMANDS = new Set(["diagnose", "checkpoints", "restore"]);
const CHANNELS = new Set(["stable", "beta"]);

export function parseCliArgs(argv = []) {
  const args = Array.from(argv);
  const command = args[0] && !args[0].startsWith("-") ? args.shift() : "help";
  if (!COMMANDS.has(command)) {
    return { command: "help", error: `unknown command: ${command}` };
  }

  const result = {
    command,
    subcommand: null,
    channel: "stable",
    plain: false,
    url: null,
    token: null,
    session: null,
    target: null,
    allowDataDowngrade: false,
    confirmToken: null,
    passthrough: [],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--plain") {
      result.plain = true;
    } else if (arg === "--allow-data-downgrade") {
      result.allowDataDowngrade = true;
    } else if (arg === "--url") {
      result.url = requireValue(args, ++i, "--url");
    } else if (arg === "--token") {
      result.token = requireValue(args, ++i, "--token");
    } else if (arg === "--session") {
      result.session = requireValue(args, ++i, "--session");
    } else if (arg === "--confirm-token") {
      result.confirmToken = requireValue(args, ++i, "--confirm-token");
    } else if (arg === "--channel") {
      const value = requireValue(args, ++i, "--channel");
      if (!CHANNELS.has(value)) {
        throw new Error(`--channel must be one of: stable, beta (got ${value})`);
      }
      result.channel = value;
    } else if (arg === "--") {
      result.passthrough = args.slice(i + 1);
      break;
    } else if (command === "continue" && !result.target) {
      result.target = arg;
    } else if (command === "bundle" && !result.subcommand && !arg.startsWith("-")) {
      result.subcommand = arg;
    } else if (command === "data" && !result.subcommand && !arg.startsWith("-")) {
      result.subcommand = arg;
    } else if (command === "data" && result.subcommand === "restore" && !result.target && !arg.startsWith("-")) {
      result.target = arg;
    } else {
      result.passthrough.push(arg);
    }
  }

  if (command === "bundle" && !BUNDLE_SUBCOMMANDS.has(result.subcommand)) {
    return {
      command: "help",
      error: result.subcommand
        ? `unknown bundle subcommand: ${result.subcommand} (expected pull or status)`
        : "bundle requires a subcommand: pull or status",
    };
  }

  if (command === "data") {
    if (!DATA_SUBCOMMANDS.has(result.subcommand)) {
      return {
        command: "help",
        error: result.subcommand
          ? `unknown data subcommand: ${result.subcommand} (expected diagnose, checkpoints, or restore)`
          : "data requires a subcommand: diagnose, checkpoints, or restore",
      };
    }
    if (result.subcommand === "restore" && !result.target) {
      return { command: "help", error: "data restore requires a transitionId: jarvis data restore <transitionId>" };
    }
  }

  return result;
}

function requireValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function helpText() {
  return `Jarvis CLI

Usage:
  jarvis serve [-- server args]        Start a headless Jarvis Server (serves the --channel web frontend, if pulled)
  jarvis status                       Show local server and agent status
  jarvis sessions                     List recent sessions
  jarvis continue [index|path]        Continue a recent session
  jarvis chat [--plain]               Open chat
  jarvis bundle pull                  Pull and activate the latest web frontend
  jarvis bundle status                Show the pulled web frontend status
  jarvis data diagnose                Read-only data-epoch diagnostics (stamp, journal, checkpoints)
  jarvis data checkpoints             List available data-epoch recovery checkpoints
  jarvis data restore <transitionId>  Restore data from a checkpoint (asks for confirmation)

Connection options:
  --url <baseUrl>                   Connect to a specific Jarvis Server
  --token <token>                   Bearer token for that server
  --session <path>                  Chat in a specific session

Serve options:
  --allow-data-downgrade            Allow this kernel to open a data directory a newer
                                     kernel already touched (risk of silent data corruption)

Channel options:
  --channel <stable|beta>           Release channel for jarvis serve and jarvis bundle (default: stable)

Data recovery options:
  --confirm-token <token>           Non-interactive confirmation for \`jarvis data restore\`.
                                     Must exactly equal "restore <transitionId>". Required
                                     when stdin is not a TTY; there is no way to skip this.
`;
}
