import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const AGENTS_REREAD_DEFAULT_EVERY = 3;
export const AGENTS_REREAD_STATE_TYPE = "agents-reread-state";
export const AGENTS_REREAD_DELIVERY_TYPE = "agents-reread-delivery";
export const AGENTS_REREAD_PAYLOAD_PROOF_TYPE = "agents-reread-payload-proof";
export const AGENTS_REREAD_CONTEXT_MESSAGE_TYPE = "agents-reread-context";

const CONTEXT_FILE_CANDIDATES = ["AGENTS.md", "CLAUDE.md"];
const REFRESH_MARKER = "# AGENTS Refresh";

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
		`This hidden reminder was injected automatically after ${completedTurns} completed agent turns (interval: ${every}).`,
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
	return isAssistantMessage(message) && message.stopReason !== "aborted" && message.stopReason !== "error";
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
		role: "custom",
		customType: AGENTS_REREAD_CONTEXT_MESSAGE_TYPE,
		content: refresh.content,
		display: false,
		details: refresh.details,
		timestamp: Date.now(),
	};
}

function logProof(pi, refresh, phase) {
	pi.appendEntry(phase === "context" ? AGENTS_REREAD_DELIVERY_TYPE : AGENTS_REREAD_PAYLOAD_PROOF_TYPE, {
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

export function createAgentsRereadExtension(options = {}) {
	return function agentsRereadExtension(pi) {
		const configuredEvery = normalizeEvery(options.every ?? getConfiguredEveryFromEnv());
		let state = createDefaultState(configuredEvery);
		let activeRefresh;

		const rebuildState = (ctx) => {
			state = restoreState(ctx, configuredEvery);
			activeRefresh = undefined;
		};

		pi.on("session_start", async (_event, ctx) => {
			rebuildState(ctx);
		});

		pi.on("session_tree", async (_event, ctx) => {
			rebuildState(ctx);
		});

		pi.on("context", async (event, ctx) => {
			const completedTurns = countCompletedAssistantTurns(event.messages);
			state.completedTurns = Math.max(state.completedTurns, completedTurns);

			if (!shouldInjectRefresh(completedTurns, state)) {
				activeRefresh = undefined;
				return undefined;
			}

			const refresh = buildRefresh(ctx.cwd, completedTurns, state.every);
			if (!refresh) {
				activeRefresh = undefined;
				return undefined;
			}

			activeRefresh = refresh;
			if (state.lastDeliveryProofCompletedTurns !== completedTurns) {
				logProof(pi, refresh, "context");
				state.lastDeliveryProofCompletedTurns = completedTurns;
				persistState(pi, state);
			}

			return {
				messages: [...event.messages, createContextMessage(refresh)],
			};
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

		pi.on("turn_end", async (event) => {
			const completedTurn = isCompletedAssistantTurn(event.message);
			if (completedTurn) {
				state.completedTurns += 1;
				if (activeRefresh && state.lastRefreshedCompletedTurns < activeRefresh.completedTurns) {
					state.lastRefreshedCompletedTurns = activeRefresh.completedTurns;
				}
			}

			activeRefresh = undefined;
			persistState(pi, state);
		});
		};
}

const configuredEvery = normalizeEvery(getConfiguredEveryFromEnv());

export default createAgentsRereadExtension({ every: configuredEvery });
