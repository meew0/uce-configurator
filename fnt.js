const FNT4 = [70, 78, 84, 52];

async function readFntFile(fileBlob) {
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

    const header = new Uint32Array(await r.readBytes(40000));

    const headerSorted = new Uint32Array(10000);
    headerSorted.set(header);
    headerSorted.sort();

    const glyphs = {};

    let last = -1;
    for(const glyphAddress of headerSorted) {
        if(glyphAddress === last) continue;
        if(r.pos > glyphAddress) throw new Error('read too far in FNT file');
        await r.seekAhead(glyphAddress - r.pos);

        const offsetX = await r.readS8();
        const offsetY = await r.readS8();
        const cropWidth = await r.readU8();
        const cropHeight = await r.readU8();
        const frameWidth = await r.readU8();
        const val6 = await r.readU8();
        const dataWidth = await r.readU8();
        const dataHeight = await r.readU8();

        const len = await r.readU16();
        const glyphData = await r.readU8Array(len);

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