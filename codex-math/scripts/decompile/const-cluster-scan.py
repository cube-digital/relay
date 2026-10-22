import sys, json
# Find code sites where the three multi-agent v2 wait-timeout defaults (10000, 3600000, 30000 ms) appear as imm32
# within one window: that is resolve_multi_agent_v2_config / MultiAgentV2Config::defaults_for_max_concurrency inlined.
data = open(sys.argv[1], 'rb').read()
text_lo, text_hi = 0x750000, 0x750000 + 0xddac2e6  # R E LOAD segment
c3600k = (3_600_000).to_bytes(4, 'little'); c10k = (10_000).to_bytes(4, 'little'); c30k = (30_000).to_bytes(4, 'little')
sites = []
i = data.find(c3600k, text_lo)
while i != -1 and i < text_hi:
    w = data[max(0, i-400):i+400]
    if c10k in w and c30k in w:
        sites.append(hex(i))
    i = data.find(c3600k, i + 1)
print(json.dumps({'sites_with_3600000_near_10000_and_30000': sites}, indent=1))
