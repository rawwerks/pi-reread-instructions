import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	AGENTS_REREAD_COMMAND_NAME,
	AGENTS_REREAD_CONTEXT_MESSAGE_TYPE,
	AGENTS_REREAD_DELIVERY_TYPE,
	AGENTS_REREAD_PAYLOAD_PROOF_TYPE,
	createAgentsRereadExtension,
	loadAgentsContextFiles,
} from "../agents-reread.ts";

const tempDirs: string[] = [];
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

function makeTempDir(prefix = "agents-reread-") {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

class MockPi {
	branch: Array<{ type: string; customType: string; data: Record<string, unknown> }> = [];
	appended: Array<{ type: string; customType: string; data: Record<string, unknown> }> = [];
	sent: Array<Record<string, unknown>> = [];
	notifications: Array<{ message: string; level: string }> = [];
	handlers = new Map<string, Function>();
	commands = new Map<string, Record<string, Function>>();

	sessionManager = {
		getBranch: () => this.branch,
	};

	on(eventName: string, handler: Function) {
		this.handlers.set(eventName, handler);
	}

	registerCommand(name: string, command: Record<string, Function>) {
		this.commands.set(name, command);
	}

	appendEntry(customType: string, data: Record<string, unknown>) {
		const entry = { type: "custom", customType, data };
		this.branch.push(entry);
		this.appended.push(entry);
	}

	sendMessage(message: Record<string, unknown>) {
		this.sent.push(message);
	}

	createContext(cwd: string) {
		return {
			cwd,
			sessionManager: this.sessionManager,
			ui: {
				notify: (message: string, level: string) => {
					this.notifications.push({ message, level });
				},
			},
		};
	}
}

async function fire(pi: MockPi, eventName: string, event: Record<string, unknown>, ctx?: Record<string, unknown>) {
	const handler = pi.handlers.get(eventName);
	if (!handler) {
		throw new Error(`Missing handler for ${eventName}`);
	}
	return await handler(event, ctx);
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
	if (originalAgentDir === undefined) {
		delete process.env.PI_CODING_AGENT_DIR;
	} else {
		process.env.PI_CODING_AGENT_DIR = originalAgentDir;
	}
});

describe("loadAgentsContextFiles", () => {
	test("loads global and ancestor context files in order", () => {
		const root = makeTempDir();
		const agentDir = join(root, "agent-home");
		const workspaceRoot = join(root, "workspace");
		const projectDir = join(workspaceRoot, "project");
		const nestedDir = join(projectDir, "src");

		mkdirSync(agentDir, { recursive: true });
		mkdirSync(nestedDir, { recursive: true });
		writeFileSync(join(agentDir, "AGENTS.md"), "global instructions\n");
		writeFileSync(join(workspaceRoot, "CLAUDE.md"), "workspace instructions\n");
		writeFileSync(join(projectDir, "AGENTS.md"), "project instructions\n");
		writeFileSync(join(projectDir, "CLAUDE.md"), "should not win over AGENTS in same directory\n");

		const files = loadAgentsContextFiles(nestedDir, agentDir);

		expect(files.map((file) => file.path)).toEqual([
			join(agentDir, "AGENTS.md"),
			join(workspaceRoot, "CLAUDE.md"),
			join(projectDir, "AGENTS.md"),
		]);
		expect(files.map((file) => file.content.trim())).toEqual([
			"global instructions",
			"workspace instructions",
			"project instructions",
		]);
	});
});

describe("createAgentsRereadExtension", () => {
	test("injects only after completed final assistant replies and logs payload proof", async () => {
		const root = makeTempDir();
		const agentDir = join(root, "agent-home");
		const cwd = join(root, "repo");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(cwd, { recursive: true });
		writeFileSync(join(agentDir, "AGENTS.md"), "global instructions\n");
		writeFileSync(join(cwd, "AGENTS.md"), "project instructions\n");
		process.env.PI_CODING_AGENT_DIR = agentDir;

		const pi = new MockPi();
		createAgentsRereadExtension({ every: 2 })(pi);
		const ctx = pi.createContext(cwd);

		await fire(pi, "session_start", {}, ctx);
		await fire(pi, "turn_end", { message: { role: "assistant", stopReason: "tool_use" } }, ctx);
		expect(pi.sent).toHaveLength(0);

		await fire(pi, "turn_end", { message: { role: "assistant", stopReason: "stop" } }, ctx);
		expect(pi.sent).toHaveLength(0);

		await fire(pi, "turn_end", { message: { role: "assistant", stopReason: "stop" } }, ctx);
		expect(pi.sent).toHaveLength(1);
		expect(pi.sent[0]).toMatchObject({
			customType: AGENTS_REREAD_CONTEXT_MESSAGE_TYPE,
			display: false,
		});
		expect(String(pi.sent[0].content)).toContain("# AGENTS Refresh");
		expect(String(pi.sent[0].content)).toContain("after 2 completed final assistant replies");

		expect(pi.appended.map((entry) => entry.customType)).toContain(AGENTS_REREAD_DELIVERY_TYPE);

		await fire(pi, "before_provider_request", { payload: { messages: [{ content: pi.sent[0].content }] } });
		expect(pi.appended.map((entry) => entry.customType)).toContain(AGENTS_REREAD_PAYLOAD_PROOF_TYPE);
	});

	test("command updates the session interval and can inject immediately", async () => {
		const root = makeTempDir();
		const agentDir = join(root, "agent-home");
		const cwd = join(root, "repo");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(cwd, { recursive: true });
		writeFileSync(join(agentDir, "AGENTS.md"), "global instructions\n");
		process.env.PI_CODING_AGENT_DIR = agentDir;

		const pi = new MockPi();
		createAgentsRereadExtension({ every: 3 })(pi);
		const ctx = pi.createContext(cwd);

		await fire(pi, "session_start", {}, ctx);
		await fire(pi, "turn_end", { message: { role: "assistant", stopReason: "stop" } }, ctx);
		expect(pi.sent).toHaveLength(0);

		const command = pi.commands.get(AGENTS_REREAD_COMMAND_NAME);
		if (!command) {
			throw new Error("agents-reread command was not registered");
		}

		await command.handler("1", ctx);
		expect(pi.sent).toHaveLength(1);
		expect(pi.notifications.at(-1)?.message).toContain("Injected a refresh immediately");

		await command.handler("status", ctx);
		expect(pi.notifications.at(-1)?.message).toContain('stopReason="stop"');
		expect(pi.notifications.at(-1)?.message).toContain("every final assistant reply");
	});
});
