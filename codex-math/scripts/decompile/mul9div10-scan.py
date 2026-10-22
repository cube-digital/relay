import sys, json, re
# Candidate sites of (x * 9) / 10 on i64: a `lea r,[r+r*8]` within 24 bytes before a `movabs r, 0x6666666666666667` (signed /10 magic).
data = open(sys.argv[1], 'rb').read()
magic = b'\x67\x66\x66\x66\x66\x66\x66\x66'
lea9 = re.compile(rb'[\x48-\x4f]\x8d[\x04\x0c\x14\x1c\x24\x2c\x34\x3c][\xc0\xc9\xd2\xdb\xe4\xed\xf6\xff]')  # lea r64,[r+r*8] same base/index
out = []
for m in re.finditer(re.escape(magic), data):
    pos = m.start()
    if pos < 2 or data[pos-2] != 0x48 or not (0xb8 <= data[pos-1] <= 0xbf): continue  # movabs r64, imm64
    window = data[max(0, pos-40):pos-2]
    hits = [hex(max(0,pos-40)+h.start()) for h in lea9.finditer(window)]
    if hits: out.append({'movabs': hex(pos-2), 'lea9': hits})
print(json.dumps({'count': len(out), 'sites': out}, indent=1))
