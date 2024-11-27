function compileSnr(precompiled, val1, val2, firstTable, bgmNames, layouter) {
    const snrBuffer = new ArrayBuffer(15000000);
    const snr = new DataView(snrBuffer);

    // Magic
    writeBytes(snr, 0, [83, 78, 82, 32]);

    // val1 & 2
    snr.setUint32(0x0c, val1, true);
    snr.setUint32(0x10, val2, true);

    let snrPos = firstTable;
    const tables = precompiled.tables;

    // Tables
    snrPos = writeTable(snr, snrPos, tables.masks, 0x24);
    snrPos = writeTable(snr, snrPos, tables.bgs, 0x28);
    snrPos = writeTable(snr, snrPos, tables.bustups, 0x2c);

    // BGM
    const bgmStart = snrPos;
    snr.setUint32(0x30, bgmStart, true);
    snr.setUint32(snrPos + 4, tables.bgms.length, true);
    snrPos += 8;
    for(const bgm of tables.bgms) {
        const file = bgm[0];
        snrPos = writeStr(snr, snrPos, file);
        const name = bgmNames[file] || bgm[1];
        snrPos = writeStr(snr, snrPos, name);
        snr.setUint16(snrPos, bgm[2], true);
        snrPos += 2;
    }
    snr.setUint32(bgmStart, snrPos - bgmStart - 8, true);
    snrPos = align(snrPos, 0x3);

    // Remaining tables
    snrPos = writeTable(snr, snrPos, tables.ses, 0x34);
    snrPos = writeTable(snr, snrPos, tables.movies, 0x38);
    snrPos = writeTable(snr, snrPos, tables.voices, 0x3c);
    snrPos = writeTable(snr, snrPos, tables.table8, 0x40);
    snrPos = writeTable(snr, snrPos, tables.table9, 0x44);
    snrPos = writeTable(snr, snrPos, tables.offset10, 0x48);
    snrPos = writeTable(snr, snrPos, tables.characters, 0x4c);
    snrPos = writeTable(snr, snrPos, tables.offset12, 0x50);
    snrPos = writeTable(snr, snrPos, tables.tips, 0x54);

    // Script
    if(precompiled.mode == 'kal') {
        snrPos = align(snrPos, 3);
    } else {
        snrPos = align(snrPos + 0x9, 3);
    }
    snr.setUint32(0x08, precompiled.dialogueLineCount, true);
    snr.setUint32(0x20, snrPos, true); // Script offset

    const labelRefs = {}, labelPositions = {};

    for(const element of precompiled.script) {
        // Resize the buffer if it might be needed
        if((snrPos + 1000000) > snrBuffer.byteLength) {
            const newByteLength = snrBuffer.byteLength * 1.5;
            console.log(`resizing snrBuffer to ${newByteLength}`);
            snrBuffer.resize(newByteLength);
        }

        if(element.type === 'label') {
            labelPositions[element.name] = snrPos;
        } else if(element.type === 'ref') {
            labelRefs[element.name] ||= [];
            labelRefs[element.name].push(snrPos);
            snrPos += 4;
        } else if(element.type === 'dialogue') {
            snrPos = writeDialogue(snr, snrPos, element, layouter);
        } else {
            snrPos = writeBytes(snr, snrPos, element);
        }
    }

    for(const labelName in labelRefs) {
        const labelPosition = labelPositions[labelName];
        if(labelPosition == undefined) throw new Error(`Label not found: ${labelName}`);

        for(const ref of labelRefs[labelName]) {
            snr.setUint32(ref, labelPosition, true);
        }
    }

    snrPos = align(snrPos, 0xf);
    snr.setUint32(0x04, snrPos, true); // File size

    return snrBuffer.slice(0, snrPos);
}

function writeBytes(dataView, pos, bytes) {
    for(const byte of bytes) {
        dataView.setUint8(pos, byte);
        pos += 1;
    }
    return pos;
}

function align(pos, alignment) {
    return (pos + alignment) & ~alignment;
}

function writeTable(dataView, pos, table, offsetLocation) {
    dataView.setUint32(offsetLocation, pos, true);
    pos = writeBytes(dataView, pos, table);
    return align(pos, 0x3);
}

function writeStr(dataView, pos, str) {
    const converted = convertToShiftJIS(str);
    dataView.setUint16(pos, converted.length, true);
    return writeBytes(dataView, pos + 2, converted);
}
