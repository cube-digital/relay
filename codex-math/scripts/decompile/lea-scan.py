import re, sys, json
# Find RIP-relative LEA/MOV instructions (REX.W? 8D/8B ModRM(mod=00,rm=101) disp32) whose target is one of the addresses.
bin_path = sys.argv[1]; targets = {int(a, 16): a for a in sys.argv[2:]}
data = open(bin_path, 'rb').read()
pat = re.compile(rb'(?:[\x40-\x4f])?(?:\x8d|\x8b)[\x05\x0d\x15\x1d\x25\x2d\x35\x3d]', re.S)
hits = {a: [] for a in targets.values()}
for m in pat.finditer(data):
    end = m.end() + 4
    if end > len(data): continue
    disp = int.from_bytes(data[m.end():end], 'little', signed=True)
    tgt = end + disp
    if tgt in targets:
        hits[targets[tgt]].append({'insn': hex(m.start()), 'next': hex(end), 'bytes': data[m.start():end].hex()})
print(json.dumps(hits, indent=1))
