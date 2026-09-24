# Capability sandbox

`layerSubprocess` uses a restricted Node `vm` context as defense in depth for agent-written code, not as a security boundary for hostile code; authorized capabilities can still reach the network, so untrusted code belongs in the Worker-loader sandbox.
