import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const AGENTS_REREAD_DEFAULT_EVERY = 3;
export const AGENTS_REREAD_STATE_TYPE = "agents-reread-state";
export const AGENTS_REREAD_DELIVERY_TYPE = "agents-reread-delivery";
export const AGENTS_REREAD_PAYLOAD_PROOF_TYPE = "agents-reread-payload-proof";
export const AGENTS_REREAD_CONTEXT_MESSAGE_TYPE = "agents-reread-context";
export const AGENTS_REREAD_COMMAND_NAME = "agents-reread";

const CONTEXT_FILE_CANDIDATES = ["AGENTS.md", "CLAUDE.md"];
const REFRESH_MARKER = "# AGENTS Refresh";
const COUNT_MODE_LABEL = 'assistant messages with stopReason="stop"';

function normalizeEvery(value) {
	if (value === undefined) {
		return AGENTS_REREAD_DEFAULT_EVERY;
	}
	if (!Number.isFinite(value)) {
		return AGENTS_REREAD_DEFAULT_EVERY;
	}
	const normalized = Math.trunc(value);
	return normalized > 0 ? normalized : 0;
}

function getConfiguredEveryFromEnv() {
	const raw = process.env.PI_AGENTS_REREAD_EVERY ?? process.env.AGENTS_REREAD_EVERY;
	if (raw === undefined) {
		return undefined;
	}
	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function getAgentDir() {
	const configured = process.env.PI_CODING_AGENT_DIR;
	if (configured) {
		return resolve(configured);
	}
	return resolve(homedir(), ".pi", "agent");
}

function loadContextFileFromDir(dir) {
	for (const fileName of CONTEXT_FILE_CANDIDATES) {
		const filePath = join(dir, fileName);
		if (!existsSync(filePath)) {
			continue;
		}
		try {
			return {
				path: filePath,
				content: readFileSync(filePath, "utf8"),
			};
		} catch {
			return undefined;
		}
	}
	return undefined;
}

export function loadAgentsContextFiles(cwd, agentDir = getAgentDir()) {
	const resolvedCwd = resolve(cwd);
	const files = [];
	const seenPaths = new Set();

	const globalContext = loadContextFileFromDir(agentDir);
	if (globalContext) {
		files.push(globalContext);
		seenPaths.add(globalContext.path);
	}

	const ancestorFiles = [];
	let currentDir = resolvedCwd;
	const root = resolve("/");

	while (true) {
		const contextFile = loadContextFileFromDir(currentDir);
		if (contextFile && !seenPaths.has(contextFile.path)) {
			ancestorFiles.unshift(contextFile);
			seenPaths.add(contextFile.path);
		}

		if (currentDir === root) {
			break;
		}

		const parentDir = resolve(currentDir, "..");
		if (parentDir === currentDir) {
			break;
		}
		currentDir = parentDir;
	}

	files.push(...ancestorFiles);
	return files;
}

function formatRefreshMessage(files, completedTurns, every) {
	const renderedFiles = files
		.map(({ path, content }) => `## ${path}\n\n${content.trimEnd()}`)
		.join("\n\n");

	return [
		REFRESH_MARKER,
		`This hidden reminder was injected automatically after ${completedTurns} completed final assistant replies (interval: ${every}).`,
		"Treat the following AGENTS.md / CLAUDE.md files as freshly re-read project instructions.",
		renderedFiles,
	].join("\n\n");
}

function hashContent(text) {
	return createHash("sha256").update(text).digest("hex");
}

function isAssistantMessage(message) {
	return Boolean(message && typeof message === "object" && message.role === "assistant");
}

function isCompletedAssistantTurn(message) {
	return isAssistantMessage(message) && message.stopReason === "stop";
}

function countCompletedAssistantTurns(messages) {
	let completedTurns = 0;
	for (const message of messages) {
		if (isCompletedAssistantTurn(message)) {
			completedTurns += 1;
		}
	}
	return completedTurns;
}

function createDefaultState(every) {
	return {
		completedTurns: 0,
		every,
		lastRefreshedCompletedTurns: 0,
	};
}

function restoreState(ctx, defaultEvery) {
	const restored = createDefaultState(defaultEvery);

	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== AGENTS_REREAD_STATE_TYPE) {
			continue;
		}

		const data = entry.data ?? {};
		if (typeof data.completedTurns === "number") {
			restored.completedTurns = Math.max(0, Math.trunc(data.completedTurns));
		} else if (typeof data.completedAgentTurns === "number") {
			restored.completedTurns = Math.max(0, Math.trunc(data.completedAgentTurns));
		}
		if (typeof data.every === "number") {
			restored.every = normalizeEvery(data.every);
		}
		if (typeof data.lastRefreshedCompletedTurns === "number") {
			restored.lastRefreshedCompletedTurns = Math.max(0, Math.trunc(data.lastRefreshedCompletedTurns));
		}
		if (typeof data.lastDeliveryProofCompletedTurns === "number") {
			restored.lastDeliveryProofCompletedTurns = Math.max(0, Math.trunc(data.lastDeliveryProofCompletedTurns));
		}
		if (typeof data.lastPayloadProofCompletedTurns === "number") {
			restored.lastPayloadProofCompletedTurns = Math.max(0, Math.trunc(data.lastPayloadProofCompletedTurns));
		}
	}

	if (restored.lastDeliveryProofCompletedTurns !== undefined) {
		restored.lastDeliveryProofCompletedTurns = Math.max(
			restored.lastDeliveryProofCompletedTurns,
			restored.lastRefreshedCompletedTurns,
		);
	}
	if (restored.lastPayloadProofCompletedTurns !== undefined) {
		restored.lastPayloadProofCompletedTurns = Math.max(
			restored.lastPayloadProofCompletedTurns,
			restored.lastRefreshedCompletedTurns,
		);
	}

	return restored;
}

function persistState(pi, state) {
	const data = {
		completedTurns: state.completedTurns,
		every: state.every,
		lastRefreshedCompletedTurns: state.lastRefreshedCompletedTurns,
	};

	if (state.lastDeliveryProofCompletedTurns !== undefined) {
		data.lastDeliveryProofCompletedTurns = state.lastDeliveryProofCompletedTurns;
	}
	if (state.lastPayloadProofCompletedTurns !== undefined) {
		data.lastPayloadProofCompletedTurns = state.lastPayloadProofCompletedTurns;
	}

	pi.appendEntry(AGENTS_REREAD_STATE_TYPE, data);
}

function shouldInjectRefresh(completedTurns, state) {
	if (state.every <= 0) {
		return false;
	}
	if (completedTurns <= 0 || completedTurns % state.every !== 0) {
		return false;
	}
	return state.lastRefreshedCompletedTurns < completedTurns;
}

function buildRefresh(cwd, completedTurns, every) {
	const files = loadAgentsContextFiles(cwd);
	if (files.length === 0) {
		return undefined;
	}

	const content = formatRefreshMessage(files, completedTurns, every);
	const contentSha256 = hashContent(content);
	return {
		completedTurns,
		content,
		contentSha256,
		details: {
			completedTurns,
			every,
			files: files.map((file) => file.path),
			contentSha256,
			contentLength: content.length,
		},
	};
}

function createContextMessage(refresh) {
	return {
		customType: AGENTS_REREAD_CONTEXT_MESSAGE_TYPE,
		content: refresh.content,
		display: false,
		details: refresh.details,
	};
}

function logProof(pi, refresh, phase) {
	pi.appendEntry(phase === "payload" ? AGENTS_REREAD_PAYLOAD_PROOF_TYPE : AGENTS_REREAD_DELIVERY_TYPE, {
		phase,
		marker: REFRESH_MARKER,
		completedTurns: refresh.completedTurns,
		every: refresh.details.every,
		files: refresh.details.files,
		contentSha256: refresh.contentSha256,
		contentLength: refresh.details.contentLength,
	});
}

function payloadContainsRefreshMarker(payload) {
	if (payload == null) {
		return false;
	}
	try {
		return JSON.stringify(payload).includes(REFRESH_MARKER);
	} catch {
		return String(payload).includes(REFRESH_MARKER);
	}
}

function formatIntervalLabel(every) {
	if (every <= 0) {
		return "disabled";
	}
	if (every === 1) {
		return "every final assistant reply";
	}
	return `every ${every} final assistant replies`;
}

function buildStatusMessage(state, configuredEvery) {
	const lastRefresh = state.lastRefreshedCompletedTurns > 0 ? String(state.lastRefreshedCompletedTurns) : "never";
	return [
		`AGENTS reread: ${formatIntervalLabel(state.every)}`,
		`Count mode: ${COUNT_MODE_LABEL}`,
		`Completed final replies: ${state.completedTurns}`,
		`Last injected refresh threshold: ${lastRefresh}`,
		`Default interval: ${formatIntervalLabel(configuredEvery)}`,
	].join("\n");
}

function parseCommandAction(args, configuredEvery) {
	const trimmed = args.trim();
	if (!trimmed || trimmed === "status") {
		return { type: "status" };
	}
	if (trimmed === "off" || trimmed === "disable") {
		return { type: "set", every: 0, description: "disabled" };
	}
	if (trimmed === "default" || trimmed === "reset") {
		return {
			type: "set",
			every: configuredEvery,
			description: `reset to default (${formatIntervalLabel(configuredEvery)})`,
		};
	}
	if (/^-?\d+$/.test(trimmed)) {
		const every = normalizeEvery(Number(trimmed));
		return { type: "set", every, description: formatIntervalLabel(every) };
	}
	return {
		type: "error",
		message: `Usage: /${AGENTS_REREAD_COMMAND_NAME} [status|off|default|<positive-integer>]`,
	};
}

function getCommandCompletions(prefix) {
	const options = ["status", "off", "default", "1", "2", "3", "5", "10"];
	const normalizedPrefix = prefix.trim();
	const filtered = options.filter((option) => option.startsWith(normalizedPrefix));
	return filtered.length > 0 ? filtered.map((value) => ({ value, label: value })) : null;
}

export function createAgentsRereadExtension(options = {}) {
	return function agentsRereadExtension(pi) {
		const configuredEvery = normalizeEvery(options.every ?? getConfiguredEveryFromEnv());
		let state = createDefaultState(configuredEvery);
		let activeRefresh;

		const rebuildState = (ctx) => {
			state = restoreState(ctx, configuredEvery);
			activeRefresh = undefined;
		};

		const deliverRefresh = (ctx, phase) => {
			if (!shouldInjectRefresh(state.completedTurns, state)) {
				activeRefresh = undefined;
				return false;
			}

			const refresh = buildRefresh(ctx.cwd, state.completedTurns, state.every);
			if (!refresh) {
				activeRefresh = undefined;
				return false;
			}

			activeRefresh = refresh;
			pi.sendMessage(createContextMessage(refresh));
			logProof(pi, refresh, phase);
			state.lastDeliveryProofCompletedTurns = refresh.completedTurns;
			state.lastRefreshedCompletedTurns = refresh.completedTurns;
			persistState(pi, state);
			return true;
		};

		pi.on("session_start", async (_event, ctx) => {
			rebuildState(ctx);
		});

		pi.on("session_tree", async (_event, ctx) => {
			rebuildState(ctx);
		});

		pi.registerCommand(AGENTS_REREAD_COMMAND_NAME, {
			description: "Show or change AGENTS reread interval for this session",
			getArgumentCompletions: getCommandCompletions,
			handler: async (args, ctx) => {
				const action = parseCommandAction(args, configuredEvery);

				if (action.type === "error") {
					ctx.ui.notify(action.message, "warning");
					return;
				}

				if (action.type === "status") {
					ctx.ui.notify(buildStatusMessage(state, configuredEvery), "info");
					return;
				}

				state.every = action.every;
				persistState(pi, state);
				const delivered = deliverRefresh(ctx, "command");
				ctx.ui.notify(
					delivered
						? `AGENTS reread ${action.description} for this session. Injected a refresh immediately.`
						: `AGENTS reread ${action.description} for this session.`,
					"info",
				);
			},
		});

		pi.on("context", async (event) => {
			state.completedTurns = Math.max(state.completedTurns, countCompletedAssistantTurns(event.messages));
			return undefined;
		});

		pi.on("before_provider_request", async (event) => {
			if (!activeRefresh) {
				return undefined;
			}
			if (state.lastPayloadProofCompletedTurns === activeRefresh.completedTurns) {
				return undefined;
			}
			if (!payloadContainsRefreshMarker(event.payload)) {
				return undefined;
			}

			logProof(pi, activeRefresh, "payload");
			state.lastPayloadProofCompletedTurns = activeRefresh.completedTurns;
			persistState(pi, state);
			return undefined;
		});

		pi.on("turn_end", async (event, ctx) => {
			const completedTurn = isCompletedAssistantTurn(event.message);
			if (completedTurn) {
				state.completedTurns += 1;
				deliverRefresh(ctx, "turn_end");
			} else {
				activeRefresh = undefined;
			}

			persistState(pi, state);
		});
	};
}

const configuredEvery = normalizeEvery(getConfiguredEveryFromEnv());

export default createAgentsRereadExtension({ every: configuredEvery });
