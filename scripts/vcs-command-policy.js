/**
 * VCS command policy for agent shells.
 * Blocks `git … --no-verify` so hook bypass is uncomfortable and obvious.
 * Also forces non-interactive editors for git/jj when the harness can rewrite.
 */

const GIT_COMMAND = /(?:^|[\s;&|()])(?:[^\s;&|()]*\/)?git(?=$|[\s;&|()])/mu;
const VCS_COMMAND =
  /(?:^|[\s;&|()])(?:[^\s;&|()]*\/)?(?:git|jj)(?=$|[\s;&|()])/mu;
const NO_VERIFY = /--no-verify(?=$|[\s;&|()])/mu;

export const NONINTERACTIVE_VCS_ENV =
  "export GIT_EDITOR=: GIT_SEQUENCE_EDITOR=: GIT_MERGE_AUTOEDIT=no JJ_EDITOR=:\n";

export const HOOK_BYPASS_REASON =
  "Blocked hook bypass. Do not use --no-verify. Fix the hook failure, or ask before changing the hook policy.";

/**
 * @typedef {{ action: "allow"; command: string } | { action: "block"; reason: string }} CommandPolicyResult
 */

/**
 * Apply allow/block policy to a shell command string.
 * @param {string} command Shell command the agent wants to run.
 * @returns {CommandPolicyResult} Allow (optionally rewritten) or block with reason.
 */
export const applyCommandPolicy = (command) => {
  if (GIT_COMMAND.test(command) && NO_VERIFY.test(command)) {
    return { action: "block", reason: HOOK_BYPASS_REASON };
  }

  if (!VCS_COMMAND.test(command)) {
    return { action: "allow", command };
  }

  return {
    action: "allow",
    command: `${NONINTERACTIVE_VCS_ENV}${command}`,
  };
};
