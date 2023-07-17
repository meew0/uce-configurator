class ReaderWrapper {
    constructor(rsdr) {
        this.reader = rsdr;
        this.pos = 0;
    }

    async readCStr() {
        let bytes = [];

        let nextByte = (await this.readDataView(1)).getUint8();
        while(nextByte != 0) {
            bytes.push(nextByte);
            nextByte = (await this.readDataView(1)).getUint8();
        }

        return (new TextDecoder().decode(new Uint8Array(bytes)));
    }

    async readU16() {
        return (await this.readDataView(2)).getUint16(0, true);
    }

    async readU32() {
        return (await this.readDataView(4)).getUint32(0, true);
    }

    async readU8Array(n) {
        return new Uint8Array(await this.readBytes(n));
    }

    async readDataView(n) {
        return new DataView(await this.readBytes(n));
    }

    async readBytes(n) {
        return await this.readOrSeek(n, true);
    }

    async seekAhead(n) {
        if(n === 0) return;
        await this.readOrSeek(n, false);
    }

    async readOrSeek(n, doRead) {
        if(this.currentChunk == null) {
            await this.tryReadNextChunk();
        }

        let buffer = doRead ? new ArrayBuffer(n) : null;
        let result = doRead ? new Uint8Array(buffer) : null;
        let bytesRead = 0;

        while(bytesRead < n) {
            const bytesToRead = Math.min(this.currentChunk.length - this.currentChunkOffset, n - bytesRead);
            if(doRead) result.set(this.currentChunk.subarray(this.currentChunkOffset, this.currentChunkOffset + bytesToRead), bytesRead);
            this.currentChunkOffset += bytesToRead;

            if(this.currentChunkOffset >= this.currentChunk.length) {
                if(this.currentChunkOffset > this.currentChunk.length) {
                    throw new Error('somehow, we read too much');
                }

                await this.tryReadNextChunk();
            }

            bytesRead += bytesToRead;
            this.pos += bytesToRead;
        }

        return doRead ? buffer : null;
    }

    async tryReadNextChunk() {
        let result = await this.reader.read();
        if(result.done) {
            throw new Error('done');
        }

        this.currentChunk = result.value;
        this.currentChunkOffset = 0;
    }
}

// Simple wrapper class around a FileSystemWritableFileStream that keeps track of the current position
class WriterPositionTracker {
    constructor(writer) {
        this.writer = writer;
        this.position = 0;
        this.length = 0;
    }

    async write(data) {
        await this.writer.write(data);
        this.position += data.length;
        if(this.position > this.length) this.length = this.position;
    }

    async seek(pos) {
        await this.writer.seek(pos);
        this.position = pos;
    }

    async align(mul) {
        const a = mul - 1;
        await this.seek((this.position + a) & ~a);
    }
}

// Wraps a File (Blob) to act as a data source for ROM file editing
class FileDataSource {
    constructor(fileBlob) {
        this.fileBlob = fileBlob;
    }

    async writeTo(w) {
        const r = this.fileBlob.stream().getReader();

        while(true) {
            const chunk = await r.read();
            if(chunk.done) break;
            await w.write(chunk.value);
        }

        await r.cancel();
    }
}

function arrayCompare(array, other) {
    for(let i = 0; i < array.length; i++) {
        if(array[i] !== other[i]) return false;
    }
    return true;
}

function binaryMD5(data) {
    // Copy data into 4-byte aligned buffer, and reinterpret as 32-bit integers
    const dataBuffer = new ArrayBuffer((data.length + 0x3) & ~0x3);
    new Uint8Array(dataBuffer).set(data);
    const uint32s = new Uint32Array(dataBuffer);

    // Calculate MD5
    const rawMD5 = binl_md5(Array.from(uint32s), data.length << 3);

    // Reinterpret as individual bytes
    const md5Buffer = new ArrayBuffer(16);
    new Uint32Array(md5Buffer).set(rawMD5);
    return new Uint8Array(md5Buffer);
}

// const ROM1 = [82, 79, 77, 32];
const ROM2 = [82, 79, 77, 50];

// Alignment of folder offsets within the header block
const FOLDER_OFFSET_MUL = 16;
const FOLDER_ALIGN = FOLDER_OFFSET_MUL - 1;

async function readRomFile(fileBlob) {
    const reader = fileBlob.stream().getReader();
    let r = new ReaderWrapper(reader);
    const magic = await r.readU8Array(4);

    if(!arrayCompare(magic, ROM2)) {
        throw new Error('file must be ROM2');
    }

    const val1 = await r.readU16();
    const val2 = await r.readU16();
    const headerSize = await r.readU32();
    const offsetMul = await r.readU32();
    await r.seekAhead(16); // checksum

    const headerStart = r.pos;

    let folders = {};
    let leastFlatOffset = null;
    while(r.pos < headerSize) {
        let start = r.pos;
        let numFiles = await r.readU32();
        let filesByNamePtr = {};
        let fileList = [];
        let folderLen = 0;

        // Read the “values section” of the folder, containing the name pointer, content pointer, and length for each file/subfolder
        for(let i = 0; i < numFiles; i++) {
            let firstU32 = await r.readU32();
            let namePtr = firstU32 & (0xffffff);
            let file = {};

            file.isFolder = !!(firstU32 & 0x80000000);
            file.flatOffset = await r.readU32();
            if(file.flatOffset > 0 && !file.isFolder && (leastFlatOffset == null || file.flatOffset < leastFlatOffset)) leastFlatOffset = file.flatOffset;
            file.length = await r.readU32();
            if(i == 0) folderLen = file.length;

            filesByNamePtr[namePtr] = file;
        }

        // Read the “names section” and match each read name to the previously read pointers
        for(let i = 0; i < numFiles; i++) {
            let relPos = r.pos - start;
            while(filesByNamePtr[relPos] == null) await r.seekAhead(1);
            let file = filesByNamePtr[relPos];
            file.name = await r.readCStr();
            fileList.push(file);
        }

        folders[(start - headerStart) / FOLDER_OFFSET_MUL] = fileList;

        let end = (start + folderLen + FOLDER_ALIGN) & ~FOLDER_ALIGN;
        await r.seekAhead(end - r.pos);
    }

    const dataOffset = leastFlatOffset * offsetMul;
    await r.seekAhead(dataOffset - r.pos);

    return {
        val1,
        val2,
        headerStart,
        folders,
        leastFlatOffset,
        offsetMul,
        provideDataReader: async function() {
            const r = new ReaderWrapper(fileBlob.stream().getReader());
            // Seek to the first data block
            await r.seekAhead(dataOffset - r.pos);
            return r;
        }
    };
}

async function writeRomFile(writer, romFile) {
    const dataOffset = romFile.leastFlatOffset * romFile.offsetMul;
    const w = new WriterPositionTracker(writer);

    // Make an index of file data pointers, to know what to
    // read in the next step
    const fileDataIndex = {};
    const fileFlatOffsets = [];
    for(const oldOffset in romFile.folders) {
        const folder = romFile.folders[oldOffset];
        for(const file of folder) {
            if(file.isFolder) continue;
            if(file.token) continue;

            fileDataIndex[file.flatOffset] = file;
            fileFlatOffsets.push(file.flatOffset);
        }
    }

    await w.seek(dataOffset);

    // Go through all the file data in the old rom file,
    // and either write the data to the new file unmodified,
    // or write the replacement data where applicable
    const r = await romFile.provideDataReader();
    const sortedFlats = new Uint32Array(fileFlatOffsets);
    sortedFlats.sort();
    const newFileMetadata = {};
    for(const oldFlat of sortedFlats) {
        let trueOldOffset = oldFlat * romFile.offsetMul;
        if(r.pos > trueOldOffset) {
            throw new Error("invalid position in old rom file data block (perhaps the length was increased without specifying a new data provider?)");
        }

        await r.seekAhead(trueOldOffset - r.pos);
        const file = fileDataIndex[oldFlat];

        if(w.position % romFile.offsetMul !== 0) {
            throw new Error("writer position not aligned");
        }

        const fileMetadata = {
            flatOffset: w.position / romFile.offsetMul
        };

        if(file.dataProvider) {
            // A new data provider was specified —
            // make it write its data to the rom file writer,
            // and keep track of how much it wrote
            // for the file length in the header
            const oldPos = w.position;
            await file.dataProvider.writeTo(w);
            fileMetadata.length = w.position - oldPos;
        } else {
            // Read the data from the old rom file,
            // and write it to the new one unmodified
            await w.write(await r.readU8Array(file.length));
            fileMetadata.length = file.length;
        }

        newFileMetadata[oldFlat] = fileMetadata;

        // Align to offset
        await w.align(romFile.offsetMul);
    }

    // Write data for new files that were not in the old rom file
    for(const oldOffset in romFile.folders) {
        const folder = romFile.folders[oldOffset];
        for(const file of folder) {
            if(file.isFolder) continue;
            if(!file.token) continue;
            if(!file.dataProvider) throw new Error('File contains token but no dataProvider');

            // Write data from provider, like above
            const oldPos = w.position;
            await file.dataProvider.writeTo(w);
            newFileMetadata[file.token] = {
                length: w.position - oldPos,
                flatOffset: oldPos / romFile.offsetMul
            }
            await w.align(romFile.offsetMul);
        }
    }

    const headerBuffer = new ArrayBuffer(romFile.leastFlatOffset * romFile.offsetMul - romFile.headerStart);
    const header = new DataView(headerBuffer);
    let headerPos = 0;

    // Go through each folder and determine how long its header entry will be,
    // and what position it will have in the header
    let currentFolderPos = 0;
    const newFolderMetadata = {};
    for(const oldOffset in romFile.folders) {
        const files = romFile.folders[oldOffset];

        const namesLen = files.reduce((a, b) => a + b.name.length + 1, 0);
        const totalLen = 4 + files.length * 12 + namesLen;

        newFolderMetadata[oldOffset] = {
            length: totalLen,
            flatOffset: currentFolderPos
        }

        currentFolderPos += Math.ceil(totalLen / FOLDER_OFFSET_MUL);
    }

    // Write each of the folders into the header
    for(const oldOffset in romFile.folders) {
        const start = headerPos;
        const files = romFile.folders[oldOffset];

        // Write number of files
        header.setUint32(headerPos, files.length, true);
        headerPos += 4;

        // Write names
        headerPos += (files.length * 12);
        const nameIndex = {};
        for(const file of files) {
            const name = file.name;

            nameIndex[name] = headerPos - start;

            const encoder = new TextEncoder();
            const bytes = encoder.encode(name);

            for(const byte of bytes) {
                header.setUint8(headerPos, byte);
                headerPos += 1;
            }

            header.setUint8(headerPos, 0);
            headerPos += 1;
        }

        const end = headerPos;

        // Write file attributes and pointers
        headerPos = start + 4;
        for(const file of files) {
            // Attributes and name pointer
            let firstU32 = nameIndex[file.name];
            if(file.isFolder) firstU32 |= 0x80000000;
            header.setUint32(headerPos, firstU32, true);
            headerPos += 4;

            if(file.isFolder && file.token) throw new Error('Cannot write a folder with a token');

            const meta = (file.isFolder ? newFolderMetadata : newFileMetadata)[file.token || file.flatOffset];
            if(meta == null) throw new Error('Could not find new metadata for file: ' + file);

            // Sanity check
            if(file.name === '.' && (meta.flatOffset * FOLDER_OFFSET_MUL) !== start) {
                throw new Error(`Writing '.' folder (old flatOffset ${file.flatOffset}) from ${start} but it should be at ${meta.flatOffset * FOLDER_OFFSET_MUL}`);
            }

            // Flat data pointer
            header.setUint32(headerPos, meta.flatOffset, true);
            headerPos += 4;

            // Length
            header.setUint32(headerPos, meta.length, true);
            headerPos += 4;
        }

        headerPos = (end + FOLDER_ALIGN) & ~FOLDER_ALIGN;
    }

    // Magic bytes
    w.seek(0);
    w.write(new Uint8Array(ROM2));

    // Metadata values
    const metaValuesBuffer = new ArrayBuffer(12);
    const metaValuesView = new DataView(metaValuesBuffer);
    const headerLength = headerPos;
    metaValuesView.setUint16(0, romFile.val1, true);
    metaValuesView.setUint16(2, romFile.val2, true);
    metaValuesView.setUint32(4, headerLength, true);
    metaValuesView.setUint32(8, romFile.offsetMul, true);
    w.write(metaValuesBuffer);

    // Header checksum
    const finalisedHeader = new Uint8Array(headerBuffer.slice(0, headerLength));
    w.write(binaryMD5(finalisedHeader));

    // Finally, the main part of the header itself
    w.write(finalisedHeader);

    // Align the end of the file
    const a = romFile.offsetMul - 1;
    writer.truncate((w.length + a) & ~a);
}

function insertFileIntoFolder(folder, file) {
    for(let i = 0; i < folder.length; i++) {
        // Ignoring the case where it would insert at the beginning,
        // since that should always be occupied by the . and .. folders
        if(folder[i].name < file.name && (i === folder.length - 1 || folder[i + 1].name > file.name)) {
            folder.splice(i + 1, 0, file);
            return;
        }
    }
    throw new Error('could not find suitable place to insert');
}

function addNewFolderToRom(romFile, parentFlatOffset, name) {
    const maxFolderFlatOffset = Object.keys(romFile.folders).reduce((a, b) => a < +b ? +b : a, 0);
    const newFlatOffset = maxFolderFlatOffset + 1;

    romFile.folders[newFlatOffset] = [
        {
            name: '.',
            isFolder: true,
            flatOffset: newFlatOffset,
            length: null
        },
        {
            name: '..',
            isFolder: true,
            flatOffset: parentFlatOffset,
            length: null
        }
    ];

    const fileInParentFolder = {
        name: name,
        isFolder: true,
        flatOffset: newFlatOffset,
        length: null
    }

    insertFileIntoFolder(romFile.folders[parentFlatOffset], fileInParentFolder);
    return fileInParentFolder;
}

// Path must be specified as an array (like ['voice', '27', 'bea_03700_.nxa'])
function patchFileInRom(romFile, path, newDataSource) {
    // Initially refer to the root folder
    let fileToEdit = {
        isFolder: true,
        flatOffset: 0
    };

    for(let i = 0; i < path.length; i++) {
        const pathEntry = path[i];
        const isLast = i === path.length - 1;
        const token = path.join('/');

        if(!fileToEdit.isFolder) {
            throw new Error(`Tried to navigate into file in path ${path} (following pathEntry: ${pathEntry})`);
        }

        const currentFlatOffset = fileToEdit.flatOffset;
        const currentFolder = romFile.folders[currentFlatOffset];
        fileToEdit = null;
        for(const file of currentFolder) {
            if(file.name === pathEntry) {
                fileToEdit = file;
            }
        }

        if(fileToEdit == null) {
            if(isLast) {
                // Add file
                const newFile = {
                    name: pathEntry,
                    isFolder: false,
                    token,
                    dataProvider: newDataSource
                };
                insertFileIntoFolder(currentFolder, newFile);
            } else {
                // Add folder
                fileToEdit = addNewFolderToRom(romFile, currentFlatOffset, pathEntry);
            }
        } else {
            if(isLast) {
                if(fileToEdit.isFolder) throw new Error('Tried to overwrite folder with file');

                // Change file
                file.token = token;
                file.dataProvider = newDataSource;
            }

            // Otherwise, nothing to do. We'll resolve the folder in the next iteration
            // (or throw an error if trying to resolve a file)
        }
    }
}
