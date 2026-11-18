"""Build the offline Traditional Chinese CFF font bundle from a Noto Sans CJK TTC."""
import json
import struct
import sys
import zlib
from base64 import b64encode
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.subset import Options, Subsetter

font = TTFont(sys.argv[1], fontNumber=3)
assert font['name'].getDebugName(6) == 'NotoSansCJKtc-Regular'
options = Options()
options.hinting = False
options.layout_features = []
subsetter = Subsetter(options=options)
subsetter.populate(unicodes=font.getBestCmap())
subsetter.subset(font)

def encode(binary):
    return b64encode(binary).decode('ascii')

cff = font['CFF '].compile(font)
cmap = font.getBestCmap()
metrics = font['hmtx'].metrics
records = b''.join(struct.pack('>IHH', code, int(glyph[3:]), metrics[glyph][0])
                   for code, glyph in sorted(cmap.items()) if glyph.startswith('cid'))
header = font['head']
data = dict(data=encode(zlib.compress(cff, 9)), metrics=encode(records),
            bounds=[header.xMin, header.yMin, header.xMax, header.yMax])
Path(sys.argv[2]).write_text('globalThis.QuoteFontAsset = ' + json.dumps(data, separators=(',', ':')) + ';\n', encoding='ascii')
