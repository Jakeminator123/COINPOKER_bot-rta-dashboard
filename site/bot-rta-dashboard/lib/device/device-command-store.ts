import { randomUUID } from "crypto";

export type DeviceCommand = {
  id: string;
  deviceId: string;
  command: string;
  payload?: unknown;
  requireAdmin: boolean;
  requestedAt: number;
  requestedBy?: string;
};

export type DeviceCommandResult = {
  id: string;
  deviceId: string;
  command: string;
  success: boolean;
  output?: unknown;
  error?: string;
  executedAt: number;
  adminRequired?: boolean;
  requireAdmin?: boolean;
};

const COMMAND_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RESULT_TTL_MS = 10 * 60 * 1000; // keep results slightly longer for polling

const commandQueues = new Map<string, DeviceCommand[]>();
const inFlight = new Map<
  string,
  {
    deviceId: string;
    command: string;
    dispatchedAt: number;
    requireAdmin: boolean;
  }
>();
const results = new Map<string, DeviceCommandResult>();

function cleanup(): void {
  const now = Date.now();

  // Cleanup queued commands
  for (const [deviceId, queue] of commandQueues.entries()) {
    const filtered = queue.filter(
      (cmd) => now - cmd.requestedAt <= COMMAND_TTL_MS
    );
    if (filtered.length > 0) {
      commandQueues.set(deviceId, filtered);
    } else {
      commandQueues.delete(deviceId);
    }
  }

  // Cleanup in-flight commands (timeout)
  for (const [commandId, meta] of inFlight.entries()) {
    if (now - meta.dispatchedAt > COMMAND_TTL_MS) {
      inFlight.delete(commandId);
    }
  }

  // Cleanup old results
  for (const [commandId, result] of results.entries()) {
    if (now - result.executedAt > RESULT_TTL_MS) {
      results.delete(commandId);
    }
  }
}

export function enqueueCommand(params: {
  deviceId: string;
  command: string;
  payload?: unknown;
  requireAdmin?: boolean;
  requestedBy?: string;
}): DeviceCommand {
  cleanup();

  const command: DeviceCommand = {
    id: randomUUID(),
    deviceId: params.deviceId,
    command: params.command,
    payload: params.payload,
    requireAdmin: Boolean(params.requireAdmin),
    requestedAt: Date.now(),
    requestedBy: params.requestedBy,
  };

  const queue = commandQueues.get(command.deviceId) ?? [];
  queue.push(command);
  commandQueues.set(command.deviceId, queue);

  return command;
}

export function dequeueCommands(
  deviceId: string,
  limit: number = 5
): DeviceCommand[] {
  cleanup();

  const queue = commandQueues.get(deviceId);
  if (!queue || queue.length === 0) {
    return [];
  }

  const commands = queue.splice(0, limit);
  if (queue.length === 0) {
    commandQueues.delete(deviceId);
  } else {
    commandQueues.set(deviceId, queue);
  }

  const now = Date.now();
  for (const cmd of commands) {
    inFlight.set(cmd.id, {
      deviceId: cmd.deviceId,
      command: cmd.command,
      dispatchedAt: now,
      requireAdmin: cmd.requireAdmin,
    });
  }

  return commands;
}

export function saveCommandResult(result: DeviceCommandResult): void {
  cleanup();
  inFlight.delete(result.id);
  results.set(result.id, result);
}

export function consumeCommandResult(
  commandId: string
): DeviceCommandResult | null {
  cleanup();
  const result = results.get(commandId) ?? null;
  if (result) {
    results.delete(commandId);
  }
  return result;
}

export function isCommandPending(commandId: string): boolean {
  cleanup();
  if (inFlight.has(commandId)) {
    return true;
  }

  for (const queue of commandQueues.values()) {
    if (queue.some((cmd) => cmd.id === commandId)) {
      return true;
    }
  }

  return false;
}

export function getPendingCommands(deviceId: string): number {
  cleanup();
  const queueSize = commandQueues.get(deviceId)?.length ?? 0;
  const inFlightCount = Array.from(inFlight.values()).filter(
    (meta) => meta.deviceId === deviceId
  ).length;
  return queueSize + inFlightCount;
}
