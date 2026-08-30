export const NONINTERACTIVE_VCS_ENV: string;
export const HOOK_BYPASS_REASON: string;

export type CommandPolicyResult =
  | { action: "allow"; command: string }
  | { action: "block"; reason: string };

export function applyCommandPolicy(command: string): CommandPolicyResult;
