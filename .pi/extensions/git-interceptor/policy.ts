/**
 * Pi-facing re-export of the shared VCS command policy.
 * Source of truth: scripts/vcs-command-policy.js
 */
export {
  applyCommandPolicy,
  HOOK_BYPASS_REASON,
  NONINTERACTIVE_VCS_ENV,
} from "../../../scripts/vcs-command-policy.js";
