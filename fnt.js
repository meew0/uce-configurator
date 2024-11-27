const FNT4 = [70, 78, 84, 52];

async function readFntFile(fileBlob, readGlyphData = true) {
    const reader = fileBlob.stream().getReader();
    let r = new ReaderWrapper(reader);

    const magic = await r.readU8Array(4);
    if(!arrayCompare(magic, FNT4)) {
        throw new Error('file must be FNT4');
    }

    const version = await r.readU32();
    const size = await r.readU32();
    const ascent = await r.readU16();
    const descent = await r.readU16();

    const header = new Uint32Array(await r.readBytes(0x40000));

    const headerSorted = new Uint32Array(0x10000);
    headerSorted.set(header);
    headerSorted.sort();

    const glyphs = {};

    let last = -1;
    for(const glyphAddress of headerSorted) {
        if(glyphAddress === last) continue;
        if(r.pos > glyphAddress) throw new Error('read too far in FNT file');
        await r.seekAhead(glyphAddress - r.pos);

        const glyphHeader = await r.readDataView(10);
        const offsetX = glyphHeader.getInt8(0);
        const offsetY = glyphHeader.getInt8(1);
        const cropWidth = glyphHeader.getUint8(2);
        const cropHeight = glyphHeader.getUint8(3);
        const frameWidth = glyphHeader.getUint8(4);
        const val6 = glyphHeader.getUint8(5);
        const dataWidth = glyphHeader.getUint8(6);
        const dataHeight = glyphHeader.getUint8(7);
        const len = glyphHeader.getUint16(8, true);

        const glyphData = readGlyphData ? await r.readU8Array(len) : null;

        glyphs[glyphAddress] = {
            offsetX, offsetY, cropWidth, cropHeight, frameWidth, val6, dataWidth, dataHeight, glyphData
        }

        last = glyphAddress;
    }

    return {
        version, size, ascent, descent,
        header,
        glyphs
    }
}